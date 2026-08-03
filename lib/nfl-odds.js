// The Odds API fetcher for NFL h2h/spreads/totals — mirrors lib/odds.js's
// fetchMLBOdds shape so app/api/nfl/odds/route.js and app/api/nfl/picks/route.js
// can share one implementation instead of duplicating the TOA call/parse logic.

import { overlayKalshiImplied } from "./kalshi-odds.js";

const TOA_KEY = process.env.THE_ODDS_API_KEY;
const TOA_BASE = "https://api.the-odds-api.com/v4";

const BOOKS = ["pinnacle", "draftkings", "fanduel", "betmgm", "caesars", "bet365", "betonlineag", "bovada"];

// SportsGameOdds supplement — same role as lib/odds.js's fetchFromSGO() for
// MLB: adds any game The Odds API doesn't have a line for yet (moneyline
// only, same as the MLB supplement). Previously SPORTSGAMEODDS_API_KEY was
// only ever read for MLB even though the app has NFL odds too — this fills
// that gap using the exact same account/key.
// UNVERIFIED against a live call — outbound access to api.sportsgameodds.com
// isn't reachable from this sandbox, so the oddID/team-name field names below
// are carried over from the proven MLB integration rather than confirmed
// against a real NFL event. Degrades to an empty array on any shape mismatch
// or fetch failure, same posture as the rest of this file.
const SGO_KEY = process.env.SPORTSGAMEODDS_API_KEY;
const SGO_BASE = "https://api.sportsgameodds.com/v2";
const SGO_PRIORITY = ["pinnacle", "circa", "betonline", "draftkings", "fanduel", "caesars", "betmgm", "bet365"];

function fmtAmerican(decimal) {
  if (!decimal) return null;
  if (decimal >= 2) return Math.round((decimal - 1) * 100);
  return -Math.round(100 / (decimal - 1));
}

function removeVig(h, a) {
  const total = h + a;
  return { fairHome: h / total, fairAway: a / total };
}

function bestLine(bookmakers, market, outcomeKey) {
  for (const book of BOOKS) {
    const bm = bookmakers?.find(b => b.key === book);
    const mkt = bm?.markets?.find(m => m.key === market);
    if (!mkt) continue;
    const outcome = mkt.outcomes?.find(o => o.name === outcomeKey || o.description === outcomeKey);
    if (outcome) return { price: outcome.price, point: outcome.point ?? null };
  }
  // fallback: first available
  for (const bm of (bookmakers || [])) {
    const mkt = bm?.markets?.find(m => m.key === market);
    if (!mkt) continue;
    const outcome = mkt.outcomes?.find(o => o.name === outcomeKey || o.description === outcomeKey);
    if (outcome) return { price: outcome.price, point: outcome.point ?? null };
  }
  return null;
}

function sgoTeamName(rawID) {
  if (!rawID) return rawID;
  return rawID
    .replace(/_NFL$/, "").replace(/_/g, " ").toLowerCase()
    .replace(/\b\w/g, c => c.toUpperCase());
}

function sgoBestLine(oddsObj, homeOddID, awayOddID) {
  const homeMarket = oddsObj?.[homeOddID]?.byBookmaker;
  const awayMarket = oddsObj?.[awayOddID]?.byBookmaker;
  if (!homeMarket || !awayMarket) return null;
  for (const bk of SGO_PRIORITY) {
    const home = homeMarket[bk];
    const away = awayMarket[bk];
    if (!home?.available || !away?.available || !home?.odds || !away?.odds) continue;
    const homeOdds = parseInt(home.odds, 10);
    const awayOdds = parseInt(away.odds, 10);
    if (isNaN(homeOdds) || isNaN(awayOdds) || homeOdds === 0 || awayOdds === 0) continue;
    return { homeOdds, awayOdds };
  }
  return null;
}

async function fetchNFLOddsFromSGO() {
  if (!SGO_KEY) return [];
  try {
    const params = new URLSearchParams({
      leagueID: "NFL",
      oddID: "points-home-game-ml-home,points-away-game-ml-away",
      oddsAvailable: "true",
      limit: "50",
      apiKey: SGO_KEY,
    });
    const res = await fetch(`${SGO_BASE}/events?${params}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) { console.warn(`[nfl-odds] SGO ${res.status}`); return []; }
    const json = await res.json();
    if (json?.error && !json?.data?.length) { console.warn("[nfl-odds] SGO error:", json.error); return []; }
    const events = json?.data || [];
    const results = [];
    for (const event of events) {
      if (event.status?.started || event.status?.ended) continue;
      const homeTeam = event.teams?.home?.names?.full || sgoTeamName(event.teams?.home?.teamID);
      const awayTeam = event.teams?.away?.names?.full || sgoTeamName(event.teams?.away?.teamID);
      const commenceTime = event.status?.startsAt;
      const eventID = event.eventID;
      if (!homeTeam || !awayTeam || !eventID) continue;
      const line = sgoBestLine(event.odds, "points-home-game-ml-home", "points-away-game-ml-away");
      if (!line) continue;
      results.push({
        id: eventID, homeTeam, awayTeam, commenceTime,
        homeOdds: line.homeOdds, awayOdds: line.awayOdds,
        homeImplied: null, awayImplied: null,
        spread: null, homeSpreadOdds: null, awaySpreadOdds: null,
        total: null, overOdds: null, underOdds: null,
      });
    }
    console.log(`[nfl-odds] SGO supplement — ${results.length} games`);
    return results;
  } catch (e) {
    console.warn("[nfl-odds] SGO fetch failed:", e.message);
    return [];
  }
}

// Same team-name normalization + "add anything not already covered" merge as
// lib/odds.js's mergeOdds(), duplicated here rather than shared because this
// file's game shape (spread/total fields) differs from lib/odds.js's.
const normTeam = s => (s || "").toLowerCase().trim().split(" ").slice(-2).join(" ");
function mergeNFLOdds(base, supplement) {
  const covered = new Set(base.map(g => `${normTeam(g.homeTeam)}|${normTeam(g.awayTeam)}`));
  const added = supplement.filter(g => !covered.has(`${normTeam(g.homeTeam)}|${normTeam(g.awayTeam)}`));
  if (added.length) console.log(`[nfl-odds] SGO added ${added.length} extra games`);
  return [...base, ...added];
}

// sportKey: "americanfootball_nfl" (regular season, default) or
// "americanfootball_nfl_preseason" — used to test the pipeline against real games
// before the regular season starts. Unverified against The Odds API's live sport
// catalog from this environment; if it 404s, check GET /v4/sports for the current key.
export async function fetchNFLOdds(sportKey = "americanfootball_nfl") {
  let mapped = [];

  if (TOA_KEY) {
    try {
      const [h2hRes, spreadRes, totalsRes] = await Promise.all([
        fetch(`${TOA_BASE}/sports/${sportKey}/odds?apiKey=${TOA_KEY}&regions=us&markets=h2h&oddsFormat=decimal&dateFormat=iso`),
        fetch(`${TOA_BASE}/sports/${sportKey}/odds?apiKey=${TOA_KEY}&regions=us&markets=spreads&oddsFormat=decimal&dateFormat=iso`),
        fetch(`${TOA_BASE}/sports/${sportKey}/odds?apiKey=${TOA_KEY}&regions=us&markets=totals&oddsFormat=decimal&dateFormat=iso`),
      ]);

      if (!h2hRes.ok) throw new Error(`Odds API error: ${h2hRes.status}`);

      const [h2hData, spreadData, totalsData] = await Promise.all([
        h2hRes.json(),
        spreadRes.ok ? spreadRes.json() : [],
        totalsRes.ok ? totalsRes.json() : [],
      ]);

      const spreadMap = {};
      const totalsMap = {};
      for (const g of (Array.isArray(spreadData) ? spreadData : [])) spreadMap[g.id] = g;
      for (const g of (Array.isArray(totalsData) ? totalsData : [])) totalsMap[g.id] = g;

      mapped = (Array.isArray(h2hData) ? h2hData : []).map(g => {
        const homeTeam = g.home_team;
        const awayTeam = g.away_team;

        const homeH2H = bestLine(g.bookmakers, "h2h", homeTeam);
        const awayH2H = bestLine(g.bookmakers, "h2h", awayTeam);

        const homeSpread = bestLine(spreadMap[g.id]?.bookmakers, "spreads", homeTeam);
        const awaySpread = bestLine(spreadMap[g.id]?.bookmakers, "spreads", awayTeam);

        const overLine = bestLine(totalsMap[g.id]?.bookmakers, "totals", "Over");
        const underLine = bestLine(totalsMap[g.id]?.bookmakers, "totals", "Under");

        const homeImpl = homeH2H ? 1 / homeH2H.price : null;
        const awayImpl = awayH2H ? 1 / awayH2H.price : null;
        const { fairHome, fairAway } = (homeImpl && awayImpl) ? removeVig(homeImpl, awayImpl) : { fairHome: null, fairAway: null };

        return {
          id: g.id,
          homeTeam,
          awayTeam,
          commenceTime: g.commence_time,
          homeOdds: homeH2H ? fmtAmerican(homeH2H.price) : null,
          awayOdds: awayH2H ? fmtAmerican(awayH2H.price) : null,
          homeImplied: fairHome,
          awayImplied: fairAway,
          spread: homeSpread?.point ?? null,
          homeSpreadOdds: homeSpread ? fmtAmerican(homeSpread.price) : null,
          awaySpreadOdds: awaySpread ? fmtAmerican(awaySpread.price) : null,
          total: overLine?.point ?? null,
          overOdds: overLine ? fmtAmerican(overLine.price) : null,
          underOdds: underLine ? fmtAmerican(underLine.price) : null,
        };
      });
    } catch (e) {
      // Fall through to the SGO supplement rather than failing the whole
      // endpoint — same resilience posture as lib/odds.js's MLB pipeline.
      console.warn("[nfl-odds] TOA fetch failed:", e.message);
    }
  }

  const sgoGames = await fetchNFLOddsFromSGO();
  const merged = sgoGames.length ? mergeNFLOdds(mapped, sgoGames) : mapped;

  // Kalshi overlay runs last and wins on any game it has a market for — see
  // lib/kalshi-odds.js and the matching comment in lib/odds.js's MLB path.
  return merged.length ? await overlayKalshiImplied(merged, "nfl") : merged;
}

// Fallback final-score source for the resolve cron, used only when ESPN's hidden
// (undocumented, unofficial) scoreboard API fails to return data — this endpoint is
// a documented, paid part of The Odds API we already integrate for lines, so it's a
// meaningfully more reliable source of truth, just with a narrower lookback window
// (the API caps daysFrom at 3) than ESPN's date-addressable scoreboard.
export async function fetchNFLScoresFromOddsAPI(daysFrom = 3) {
  if (!TOA_KEY) return [];
  try {
    const res = await fetch(`${TOA_BASE}/sports/americanfootball_nfl/scores/?apiKey=${TOA_KEY}&daysFrom=${daysFrom}&dateFormat=iso`);
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return data
      .filter(g => g.completed)
      .map(g => {
        const home = g.scores?.find(s => s.name === g.home_team);
        const away = g.scores?.find(s => s.name === g.away_team);
        return {
          id: g.id,
          date: g.commence_time,
          completed: true,
          homeTeam: g.home_team,
          awayTeam: g.away_team,
          homeScore: home?.score != null ? Number(home.score) : null,
          awayScore: away?.score != null ? Number(away.score) : null,
        };
      })
      .filter(g => g.homeScore != null && g.awayScore != null && !Number.isNaN(g.homeScore) && !Number.isNaN(g.awayScore));
  } catch (e) {
    console.warn("[nfl-odds] scores fallback fetch failed:", e.message);
    return [];
  }
}
