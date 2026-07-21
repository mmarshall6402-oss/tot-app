import { americanToDecimal, decimalToImplied, removeVig } from "./edge.js";

const TOA_KEY  = process.env.THE_ODDS_API_KEY;
const TOA_BASE = "https://api.the-odds-api.com/v4";
const TOA_PRIORITY = ["pinnacle","draftkings","fanduel","betmgm","caesars","bet365","betonlineag","bovada"];

const SGO_KEY  = process.env.SPORTSGAMEODDS_API_KEY;
const SGO_BASE = "https://api.sportsgameodds.com/v2";
const SGO_PRIORITY = ["pinnacle","circa","betonline","draftkings","fanduel","caesars","betmgm","bet365"];

const TTL = 1000 * 60 * 15; // 15 minutes

function buildOddsEntry(homeOdds, awayOdds, homeTeam, awayTeam, commenceTime, id, source) {
  const homeDecimal = americanToDecimal(homeOdds);
  const awayDecimal = americanToDecimal(awayOdds);
  const homeImplied = decimalToImplied(homeDecimal);
  const awayImplied = decimalToImplied(awayDecimal);
  const { fairHome, fairAway } = removeVig(homeImplied, awayImplied);
  return { id, homeTeam, awayTeam, commenceTime, homeOdds, awayOdds, homeImplied: fairHome, awayImplied: fairAway, homeDecimal, awayDecimal, ...(source ? { source } : {}) };
}

function ctDate(d = new Date()) {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(d);
  return `${p.find(x => x.type === "year").value}-${p.find(x => x.type === "month").value}-${p.find(x => x.type === "day").value}`;
}

const norm = s => (s || "").toLowerCase().trim();
function gameKey(home, away) {
  const lw = s => norm(s).split(" ").slice(-2).join(" ");
  return `${lw(home)}|${lw(away)}`;
}

// ── The Odds API (primary) ────────────────────────────────────────────────────

async function fetchFromTheOddsAPI() {
  if (!TOA_KEY) throw new Error("THE_ODDS_API_KEY not set");
  const url = `${TOA_BASE}/sports/baseball_mlb/odds?apiKey=${TOA_KEY}&regions=us&markets=h2h&oddsFormat=american&dateFormat=iso`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`The Odds API ${res.status}`);
  const events = await res.json();
  if (!Array.isArray(events)) throw new Error("The Odds API unexpected response");

  const today = ctDate();
  const tomorrow = ctDate(new Date(Date.now() + 86400000));
  const results = [];
  for (const event of events) {
    const t = new Date(event.commence_time);
    const eventUtcDate = t.toISOString().split("T")[0];
    const eventCtDate  = ctDate(t);
    if (eventUtcDate !== today && eventCtDate !== today &&
        eventUtcDate !== tomorrow && eventCtDate !== tomorrow) continue;

    const homeTeam = event.home_team;
    const awayTeam = event.away_team;
    if (!homeTeam || !awayTeam) continue;

    let homeOdds = null, awayOdds = null;
    const bookmakers = event.bookmakers || [];

    const tryBk = (key) => {
      const bk = bookmakers.find(b => b.key === key);
      if (!bk) return false;
      const h2h = bk.markets?.find(m => m.key === "h2h");
      if (!h2h) return false;
      const ho = h2h.outcomes.find(o => o.name === homeTeam);
      const ao = h2h.outcomes.find(o => o.name === awayTeam);
      if (!ho || !ao) return false;
      homeOdds = ho.price;
      awayOdds = ao.price;
      return true;
    };

    let found = TOA_PRIORITY.some(tryBk);
    if (!found) found = bookmakers.some(b => tryBk(b.key));
    if (!found || homeOdds == null || awayOdds == null) continue;

    results.push(buildOddsEntry(homeOdds, awayOdds, homeTeam, awayTeam, event.commence_time, event.id, "theoddsapi"));
  }
  console.log(`[odds] The Odds API — ${results.length} games`);
  return results;
}

// ── SportsGameOdds (supplement — adds Pinnacle sharp lines where available) ──

function getBestSGOLine(oddsObj, homeOddID, awayOddID) {
  const homeMarket = oddsObj?.[homeOddID]?.byBookmaker;
  const awayMarket = oddsObj?.[awayOddID]?.byBookmaker;
  if (!homeMarket || !awayMarket) return null;
  for (const bk of SGO_PRIORITY) {
    const home = homeMarket[bk];
    const away = awayMarket[bk];
    if (!home?.available || !away?.available) continue;
    if (!home?.odds || !away?.odds) continue;
    const homeOdds = parseInt(home.odds, 10);
    const awayOdds = parseInt(away.odds, 10);
    if (isNaN(homeOdds) || isNaN(awayOdds) || homeOdds === 0 || awayOdds === 0) continue;
    return { homeOdds, awayOdds, bookmaker: bk };
  }
  return null;
}

function cleanTeamName(rawID) {
  if (!rawID) return rawID;
  return rawID
    .replace(/_MLB$/, "").replace(/_/g, " ").toLowerCase()
    .replace(/\b\w/g, c => c.toUpperCase())
    .replace(/\bSt\b/g, "St.").replace(/\bNy\b/g, "NY").replace(/\bLa\b/g, "LA");
}

async function fetchFromSGO() {
  if (!SGO_KEY) return [];
  const params = new URLSearchParams({
    leagueID: "MLB",
    oddID: "points-home-game-ml-home,points-away-game-ml-away",
    oddsAvailable: "true",
    limit: "50",
    apiKey: SGO_KEY,
  });
  const res = await fetch(`${SGO_BASE}/events?${params}`);
  if (!res.ok) { console.warn(`[odds] SGO ${res.status}`); return []; }
  const json = await res.json();
  if (json?.error && !json?.data?.length) { console.warn("[odds] SGO error:", json.error); return []; }
  const events = json?.data || [];
  const results = [];
  for (const event of events) {
    if (event.status?.started || event.status?.ended) continue;
    const homeTeam = event.teams?.home?.names?.full || cleanTeamName(event.teams?.home?.teamID);
    const awayTeam = event.teams?.away?.names?.full || cleanTeamName(event.teams?.away?.teamID);
    const commenceTime = event.status?.startsAt;
    const eventID = event.eventID;
    if (!homeTeam || !awayTeam || !eventID) continue;
    const line = getBestSGOLine(event.odds, "points-home-game-ml-home", "points-away-game-ml-away");
    if (!line) continue;
    results.push(buildOddsEntry(line.homeOdds, line.awayOdds, homeTeam, awayTeam, commenceTime, eventID, "sgo"));
  }
  console.log(`[odds] SGO supplement — ${results.length} games`);
  return results;
}

// ── SportsGameOdds player props (pitcher strikeouts, batter home runs) ──────
// oddID format verified against real production usage of this same API
// across several independent public repos (SportsGameOdds' own docs pages
// return 403 to automated fetches, so this couldn't be confirmed directly
// against their docs): "{stat}-{PLAYER_ID}-game-ou-{over|under}", e.g.
// "pitching_strikeouts-JACOB_DEGROM_1_MLB-game-ou-over". The literal string
// "PLAYER_ID" as a wildcard in the oddID query param returns every player's
// line for that stat, not just one specific player.
//
// UNVERIFIED against a live response — this account has been rate-limited/
// out of quota the whole time this was written, so it's never actually run
// end to end. Confirm the parsed shape (especially the `players` name
// lookup and the over/under odds fields) against one real event before
// trusting this in production.

const SGO_PROP_STAT = { strikeouts: "pitching_strikeouts", homeRuns: "batting_homeRuns" };

function parseSGOPlayerId(oddID, statKey) {
  const prefix = `${statKey}-`;
  const suffix = "-game-ou-over";
  if (!oddID.startsWith(prefix) || !oddID.endsWith(suffix)) return null;
  return oddID.slice(prefix.length, -suffix.length);
}

function sgoPlayerName(players, playerID) {
  const p = players?.[playerID];
  const fromDict = p?.name || p?.fullName || p?.displayName;
  if (fromDict) return fromDict;
  // Fallback: reconstruct from the ID slug itself (e.g. "JACOB_DEGROM_1_MLB")
  // if the event didn't include a players name dictionary.
  return cleanTeamName(playerID.replace(/_\d+_MLB$/, "").replace(/_MLB$/, ""));
}

function getBestSGOPropOdds(oddsObj, overID, underID) {
  const over = oddsObj?.[overID];
  const under = oddsObj?.[underID];
  if (!over || !under) return null;
  const line = parseFloat(over.bookOverUnder ?? over.overUnderValue ?? 0.5);

  for (const bk of SGO_PRIORITY) {
    const o = over.byBookmaker?.[bk];
    const u = under.byBookmaker?.[bk];
    if (!o?.available || !u?.available || !o?.odds || !u?.odds) continue;
    const overOdds = parseInt(o.odds, 10);
    const underOdds = parseInt(u.odds, 10);
    if (isNaN(overOdds) || isNaN(underOdds)) continue;
    return { line, overOdds, underOdds, bookmaker: bk };
  }
  // No priority book has both sides — fall back to consensus.
  const overOdds = parseInt(over.bookOdds, 10);
  const underOdds = parseInt(under.bookOdds, 10);
  if (isNaN(overOdds) || isNaN(underOdds)) return null;
  return { line, overOdds, underOdds, bookmaker: "consensus" };
}

export async function fetchSGOPlayerProps() {
  if (!SGO_KEY) return [];
  const oddIDs = [
    `${SGO_PROP_STAT.strikeouts}-PLAYER_ID-game-ou-over`,
    `${SGO_PROP_STAT.homeRuns}-PLAYER_ID-game-ou-over`,
  ].join(",");
  const params = new URLSearchParams({
    leagueID: "MLB",
    oddID: oddIDs,
    includeOpposingOddIDs: "true",
    oddsAvailable: "true",
    limit: "50",
    apiKey: SGO_KEY,
  });
  const res = await fetch(`${SGO_BASE}/events?${params}`);
  if (!res.ok) { console.warn(`[odds-props] SGO ${res.status}`); return []; }
  const json = await res.json();
  if (json?.error && !json?.data?.length) { console.warn("[odds-props] SGO error:", json.error); return []; }
  const events = json?.data || [];

  const results = [];
  for (const event of events) {
    if (event.status?.started || event.status?.ended) continue;
    const eventID = event.eventID;
    if (!eventID) continue;
    const odds = event.odds || {};
    const players = event.players || {};

    const strikeouts = [];
    const homeRuns = [];
    for (const oddID of Object.keys(odds)) {
      for (const [propKey, statKey] of Object.entries(SGO_PROP_STAT)) {
        const playerID = parseSGOPlayerId(oddID, statKey);
        if (!playerID) continue;
        const underID = oddID.replace("-game-ou-over", "-game-ou-under");
        const best = getBestSGOPropOdds(odds, oddID, underID);
        if (!best) continue;
        const player = sgoPlayerName(players, playerID);
        if (!player) continue;
        if (propKey === "strikeouts") {
          strikeouts.push({ player, line: best.line, overOdds: best.overOdds, underOdds: best.underOdds, bookmaker: best.bookmaker });
        } else {
          homeRuns.push({ player, yesOdds: best.overOdds, noOdds: best.underOdds, bookmaker: best.bookmaker });
        }
      }
    }
    if (strikeouts.length || homeRuns.length) {
      results.push({
        eventId: eventID,
        homeTeam: event.teams?.home?.names?.full || cleanTeamName(event.teams?.home?.teamID),
        awayTeam: event.teams?.away?.names?.full || cleanTeamName(event.teams?.away?.teamID),
        strikeouts,
        homeRuns,
      });
    }
  }
  console.log(`[odds-props] SGO — ${results.length} events with prop lines`);
  return results;
}

// ── ESPN scoreboard fallback (free, no key, covers every scheduled game) ─────

async function fetchFromESPN() {
  const d = ctDate().replace(/-/g, "");
  const url = `https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard?dates=${d}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ESPN scoreboard ${res.status}`);
  const json = await res.json();
  const events = json?.events || [];

  const results = [];
  for (const event of events) {
    const comp = event.competitions?.[0];
    if (!comp) continue;
    const home = comp.competitors?.find(c => c.homeAway === "home");
    const away = comp.competitors?.find(c => c.homeAway === "away");
    if (!home || !away) continue;
    const homeTeam = home.team?.displayName;
    const awayTeam = away.team?.displayName;
    if (!homeTeam || !awayTeam) continue;
    const commenceTime = comp.date || event.date;

    let homeOdds = null, awayOdds = null;
    for (const o of (comp.odds || [])) {
      const h = o.homeTeamOdds?.moneyLine ?? o.homeTeamOdds?.current?.moneyLine;
      const a = o.awayTeamOdds?.moneyLine ?? o.awayTeamOdds?.current?.moneyLine;
      if (h != null && a != null && !isNaN(parseInt(h, 10)) && !isNaN(parseInt(a, 10))) {
        homeOdds = parseInt(h, 10);
        awayOdds = parseInt(a, 10);
        break;
      }
    }
    if (homeOdds == null || awayOdds == null) continue;
    results.push(buildOddsEntry(homeOdds, awayOdds, homeTeam, awayTeam, commenceTime, String(event.id), "espn"));
  }
  console.log(`[odds] ESPN fallback — ${results.length} games`);
  return results;
}

// ── Merge: add games from supplement not already in base ─────────────────────

function mergeOdds(base, supplement, label = "supplement") {
  const covered = new Set(base.map(g => gameKey(g.homeTeam, g.awayTeam)));
  const added = supplement.filter(g => !covered.has(gameKey(g.homeTeam, g.awayTeam)));
  if (added.length) console.log(`[odds] ${label} added ${added.length} extra games`);
  return [...base, ...added];
}

// ── Cache ─────────────────────────────────────────────────────────────────────

let _cache = null;
let _cacheTime = 0;
let _inflight = null;

// Per-source outcome from the most recent live fetch — surfaced through
// /api/picks when the final result set is empty so "no games" can be told
// apart from "every odds source failed" without digging through server logs.
let _lastDiag = null;
export function getOddsDiagnostics() { return _lastDiag; }

async function _fetchFresh() {
  const diag = { toa: null, sgo: null, espn: null };

  // Primary: The Odds API covers every scheduled MLB game
  let results = [];
  try {
    results = await fetchFromTheOddsAPI();
    diag.toa = { ok: true, games: results.length };
  } catch (e) {
    console.warn("[odds] TOA primary failed:", e.message);
    diag.toa = { ok: false, error: e.message };
    // Serve stale cache if available (< 2h old)
    if (_cache && Date.now() - _cacheTime < 2 * 3600 * 1000) {
      console.warn("[odds] serving stale cache after TOA failure");
      _lastDiag = diag;
      return _cache;
    }
  }

  // Supplement with SGO and ESPN in parallel — cover any gaps TOA missed
  const [sgoRes, espnRes] = await Promise.allSettled([
    fetchFromSGO().catch(e => { console.warn("[odds] SGO failed:", e.message); diag.sgo = { ok: false, error: e.message }; return []; }),
    fetchFromESPN().catch(e => { console.warn("[odds] ESPN failed:", e.message); diag.espn = { ok: false, error: e.message }; return []; }),
  ]);
  if (sgoRes.status === "fulfilled") {
    if (!diag.sgo) diag.sgo = { ok: true, games: sgoRes.value.length };
    if (sgoRes.value?.length) results = mergeOdds(results, sgoRes.value, "SGO");
  }
  if (espnRes.status === "fulfilled") {
    if (!diag.espn) diag.espn = { ok: true, games: espnRes.value.length };
    if (espnRes.value?.length) results = mergeOdds(results, espnRes.value, "ESPN");
  }

  _lastDiag = diag;

  if (results.length) {
    _cache = results;
    _cacheTime = Date.now();
    console.log(`[odds] cached ${results.length} games`);
    return results;
  }

  // Last resort: stale cache
  if (_cache) {
    console.warn("[odds] all sources empty — serving stale cache");
    return _cache;
  }
  return [];
}

export async function fetchMLBOdds() {
  if (_cache && Date.now() - _cacheTime < TTL) {
    console.log("[odds] cache hit");
    return _cache;
  }
  if (_inflight) {
    console.log("[odds] deduped — waiting on inflight");
    return _inflight;
  }
  _inflight = _fetchFresh().finally(() => { _inflight = null; });
  return _inflight;
}
