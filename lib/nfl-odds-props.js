/**
 * lib/nfl-odds-props.js
 *
 * Per-event NFL player prop odds (receptions, receiving yards, rushing
 * yards, passing yards, anytime TD) from The Odds API. Mirrors
 * lib/odds-props.js's MLB player-props fetcher — same per-event endpoint
 * shape, same book-priority merge, same cache posture — just a different
 * set of market keys and an extra Over/Under market family instead of a
 * single strikeout line.
 *
 * IMPORTANT — unverified against a live response: this parses The Odds
 * API's documented player-props outcome shape (`description` = player
 * name, `name` = "Over"/"Under" or "Yes"/"No", `point` = the stat line).
 * Confirm against one real NFL event with props posted before trusting
 * output in production.
 */

const TOA_KEY  = process.env.THE_ODDS_API_KEY;
const TOA_BASE = "https://api.the-odds-api.com/v4";
const PROP_BOOK_PRIORITY = ["draftkings", "fanduel", "betmgm", "caesars", "pinnacle", "bet365"];

// Over/Under markets, keyed by the stat they represent — order here is the
// fallback preference when a player has lines in more than one market.
const OU_MARKETS = ["player_receptions", "player_reception_yds", "player_rush_yds", "player_pass_yds"];
const YES_NO_MARKETS = ["player_anytime_td"];
const ALL_MARKETS = [...OU_MARKETS, ...YES_NO_MARKETS];

const TTL = 1000 * 60 * 30; // 30 minutes
const _cache = new Map(); // eventId -> { data, ts }

function pickBestOutcome(outcomesByBook, player, sideNames) {
  for (const book of PROP_BOOK_PRIORITY) {
    const outcomes = outcomesByBook.get(book);
    if (!outcomes) continue;
    const sides = sideNames.map(name => outcomes.find(o => o.description === player && o.name === name));
    if (sides.every(Boolean)) return { sides, bookmaker: book };
  }
  for (const [book, outcomes] of outcomesByBook) {
    const sides = sideNames.map(name => outcomes.find(o => o.description === player && o.name === name));
    if (sides.every(Boolean)) return { sides, bookmaker: book };
  }
  return null;
}

function parseEventProps(event) {
  const byMarket = new Map(); // marketKey -> Map(book -> outcomes[])
  const playersByMarket = new Map(); // marketKey -> Set(player names)

  for (const bk of event.bookmakers || []) {
    for (const market of bk.markets || []) {
      if (!ALL_MARKETS.includes(market.key)) continue;
      if (!byMarket.has(market.key)) byMarket.set(market.key, new Map());
      byMarket.get(market.key).set(bk.key, market.outcomes || []);
      if (!playersByMarket.has(market.key)) playersByMarket.set(market.key, new Set());
      for (const o of market.outcomes || []) if (o.description) playersByMarket.get(market.key).add(o.description);
    }
  }

  const lines = { }; // marketKey -> [{ player, line, overOdds, underOdds, bookmaker }]
  for (const marketKey of OU_MARKETS) {
    const outcomesByBook = byMarket.get(marketKey);
    if (!outcomesByBook) continue;
    const rows = [];
    for (const player of playersByMarket.get(marketKey) || []) {
      const best = pickBestOutcome(outcomesByBook, player, ["Over", "Under"]);
      if (!best) continue;
      const [over, under] = best.sides;
      if (over.point == null) continue;
      rows.push({ player, line: over.point, overOdds: over.price, underOdds: under.price, bookmaker: best.bookmaker });
    }
    lines[marketKey] = rows;
  }

  for (const marketKey of YES_NO_MARKETS) {
    const outcomesByBook = byMarket.get(marketKey);
    if (!outcomesByBook) continue;
    const rows = [];
    for (const player of playersByMarket.get(marketKey) || []) {
      const best = pickBestOutcome(outcomesByBook, player, ["Yes", "No"]);
      if (!best) continue;
      const [yes, no] = best.sides;
      rows.push({ player, yesOdds: yes.price, noOdds: no.price, bookmaker: best.bookmaker });
    }
    lines[marketKey] = rows;
  }

  return { eventId: event.id, homeTeam: event.home_team, awayTeam: event.away_team, ...lines };
}

export async function fetchNFLEventPlayerProps(eventId) {
  if (!TOA_KEY) throw new Error("THE_ODDS_API_KEY not set");
  const hit = _cache.get(eventId);
  if (hit && Date.now() - hit.ts < TTL) return hit.data;

  const url = `${TOA_BASE}/sports/americanfootball_nfl/events/${eventId}/odds` +
    `?apiKey=${TOA_KEY}&regions=us&markets=${ALL_MARKETS.join(",")}&oddsFormat=american&dateFormat=iso`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`The Odds API NFL props ${res.status}`);
  const event = await res.json();
  const data = parseEventProps(event);
  _cache.set(eventId, { data, ts: Date.now() });
  return data;
}
