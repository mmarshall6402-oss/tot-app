// lib/kalshi-odds.js
//
// Kalshi (CFTC-regulated prediction market) as the priority implied-probability
// source for MLB/NFL moneyline edge calculation. A prediction-market price
// carries a much thinner built-in spread than a retail sportsbook's vig
// (roughly 0.85% vs 4.62% in measured markets), so where Kalshi has a market
// for a game, its price is a sharper "what does the market actually think"
// signal than a sportsbook line — and it's a signal this app's users can act
// on in states where sportsbook betting is illegal but prediction markets
// operate nationally.
//
// Reading market data needs no API key or account — GetMarkets/GetMarket are
// public endpoints. Only placing orders requires the RSA-signed auth this app
// never does.
//
// UNVERIFIED against a live call: outbound access to trading-api.kalshi.com
// isn't reachable from this dev sandbox, so the field names and series
// tickers below are the best-effort read from Kalshi's public docs and
// third-party developer guides, not confirmed against a real response.
// Every parse step degrades to leaving that game's odds untouched (never
// throws), so a shape mismatch just falls straight through to the existing
// sportsbook chain in lib/odds.js / lib/nfl-odds.js — same defensive posture
// as this repo's other UNVERIFIED integrations (see lib/nfl-roster.js's
// SportsData.io section, or lib/odds.js's SGO player-props comment).
// Confirm this against one real response — especially the series tickers,
// and whether yes_ask is actually populated — before fully trusting it.

const KALSHI_BASE = "https://trading-api.kalshi.com/trade-api/v2";

// MLB's KXMLBGAME series is confirmed to exist (kalshi.com/markets/kxmlbgame).
// NFL's is a best guess by the same naming convention and is NOT confirmed —
// an unrecognized or empty series just yields zero Kalshi games for that
// sport, so this fails soft rather than needing to be right upfront.
const SERIES = { mlb: "KXMLBGAME", nfl: "KXNFLGAME" };

const norm = s => (s || "").toLowerCase().trim();
const lastWords = (s, n = 1) => norm(s).split(" ").slice(-n).join(" ");

// Kalshi prices are cents (1-99) = probability directly, no American-odds
// conversion needed. Prefer the yes_bid/yes_ask midpoint when both sides of
// the book are quoted; if asks aren't populated (some third-party guides
// note GetMarkets only reliably returns bids), fall back to averaging the
// two bid-implied prices (yes_bid and 100-no_bid) — the same self-correcting
// mid-price technique, just built from the two bids instead of a bid/ask pair.
function impliedFromMarket(market) {
  const yb = market?.yes_bid, ya = market?.yes_ask, nb = market?.no_bid;
  if (typeof yb === "number" && typeof ya === "number") return (yb + ya) / 2 / 100;
  if (typeof yb === "number" && typeof nb === "number") return (yb + (100 - nb)) / 2 / 100;
  if (typeof market?.last_price === "number") return market.last_price / 100;
  return null;
}

async function fetchSeriesMarkets(seriesTicker) {
  const url = `${KALSHI_BASE}/markets?series_ticker=${seriesTicker}&status=open&limit=200`;
  const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error(`Kalshi markets ${res.status}`);
  const json = await res.json();
  return Array.isArray(json?.markets) ? json.markets : [];
}

// Matches a Kalshi market to one of this app's games by team name. Kalshi
// titles/subtitles are natural-language ("New York Yankees" / "Yankees"),
// so this uses the same fuzzy last-word(s) matching this app already relies
// on for MLB/NFL team lookups elsewhere (see lib/team-list.js's
// matchMLBTeam/matchNFLTeam and lib/odds.js's gameKey()).
//
// `title` only, not subtitle — each market is a one-sided "will <team> win"
// question, but a shared "<team> @ <team>" subtitle describing the whole
// game would match BOTH teams on BOTH markets, which is the difference
// between "which market is this team's" and "which game is this." Mixing
// them in let the away lookup and the home lookup resolve to the identical
// market in testing (see the same-market guard in overlayKalshiImplied,
// which exists because this is the one thing that must never happen).
function marketMentionsTeam(market, teamName) {
  const hay = norm(market?.title || market?.yes_sub_title || "");
  if (!hay || !teamName) return false;
  return hay.includes(lastWords(teamName, 2)) || hay.includes(lastWords(teamName, 1));
}

// games: this sport's odds-chain output (already has homeTeam/awayTeam from
// the sportsbook fetch) — used only to know which games to look for on
// Kalshi. Kalshi moneylines are two independent YES markets (one per team,
// "will <team> win"), not two outcomes of one market like The Odds API's
// h2h, so home and away are matched and priced separately. Only
// homeImplied/awayImplied/source are overwritten on a match; homeOdds/
// awayOdds (the sportsbook's American-odds display) are left as-is since
// Kalshi has no native American-odds equivalent.
export async function overlayKalshiImplied(games, sport) {
  const seriesTicker = SERIES[sport];
  if (!seriesTicker || !games?.length) return games;

  let markets;
  try {
    markets = await fetchSeriesMarkets(seriesTicker);
  } catch (e) {
    console.warn(`[kalshi] ${sport} markets fetch failed:`, e.message);
    return games;
  }
  if (!markets.length) return games;

  let matched = 0;
  const overlaid = games.map(game => {
    const homeMarket = markets.find(m => marketMentionsTeam(m, game.homeTeam));
    const awayMarket = markets.find(m => marketMentionsTeam(m, game.awayTeam));
    // A market is inherently one-sided ("will <team> win") — home and away
    // resolving to the identical object means the title match wasn't
    // actually team-specific (a shape this repo can't confirm live, see the
    // file header), and trusting it would silently produce a fake 50/50
    // split. Bail to the untouched sportsbook odds instead.
    if (!homeMarket || !awayMarket || homeMarket === awayMarket) return game;

    const homeImplied = impliedFromMarket(homeMarket);
    const awayImplied = impliedFromMarket(awayMarket);
    if (homeImplied == null || awayImplied == null) return game;

    // Normalize the pair to sum to 1 the same way every other source in this
    // app does (lib/edge.js's removeVig) — Kalshi's book carries a much
    // thinner spread than a sportsbook's vig, but still isn't perfectly
    // two-sided.
    const total = homeImplied + awayImplied;
    matched++;
    return {
      ...game,
      homeImplied: homeImplied / total,
      awayImplied: awayImplied / total,
      source: "kalshi",
    };
  });

  console.log(`[kalshi] ${sport} — overlaid ${matched}/${games.length} game(s) with Kalshi prices`);
  return overlaid;
}
