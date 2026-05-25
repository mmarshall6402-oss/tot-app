import { americanToDecimal, decimalToImplied, removeVig } from "./edge.js";

const API_KEY    = process.env.SPORTSGAMEODDS_API_KEY;
const BASE       = "https://api.sportsgameodds.com/v2";
const TTL        = 1000 * 60 * 15; // 15 minutes

// The Odds API — second fallback (free tier, broader coverage than SportsData.io)
const TOA_KEY  = process.env.THE_ODDS_API_KEY;
const TOA_BASE = "https://api.the-odds-api.com/v4";

// SportsData.io — third fallback (narrowest coverage, kept as last resort)
const SD_KEY  = process.env.SPORTSDATA_API_KEY;
const SD_BASE = "https://api.sportsdata.io/v3/mlb/scores/json";

// SportsData.io 3-letter team key → canonical full name
const SD_TEAM = {
  LAD:"Los Angeles Dodgers",SDP:"San Diego Padres",NYY:"New York Yankees",
  NYM:"New York Mets",CWS:"Chicago White Sox",CHC:"Chicago Cubs",
  KCR:"Kansas City Royals",LAA:"Los Angeles Angels",STL:"St. Louis Cardinals",
  SFG:"San Francisco Giants",TBR:"Tampa Bay Rays",MIL:"Milwaukee Brewers",
  MIN:"Minnesota Twins",HOU:"Houston Astros",ATL:"Atlanta Braves",
  BOS:"Boston Red Sox",SEA:"Seattle Mariners",TEX:"Texas Rangers",
  TOR:"Toronto Blue Jays",CLE:"Cleveland Guardians",DET:"Detroit Tigers",
  BAL:"Baltimore Orioles",PHI:"Philadelphia Phillies",ARI:"Arizona Diamondbacks",
  COL:"Colorado Rockies",MIA:"Miami Marlins",PIT:"Pittsburgh Pirates",
  CIN:"Cincinnati Reds",ATH:"Athletics",WSH:"Washington Nationals",
};

// Bookmaker priority lists per source
const SGO_PRIORITY = ["pinnacle","circa","betonline","draftkings","fanduel","caesars","betmgm","bet365"];
const TOA_PRIORITY = ["pinnacle","draftkings","fanduel","betmgm","caesars","bet365","betonlineag","bovada","mybookieag","williamhill_us"];

// CT date string for a given Date (or now)
function ctDate(d = new Date()) {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(d);
  return `${p.find(x=>x.type==="year").value}-${p.find(x=>x.type==="month").value}-${p.find(x=>x.type==="day").value}`;
}

// Dedup key for a game — last word of each team name (handles Red Sox / White Sox via 2-word suffix)
const norm = s => (s || "").toLowerCase().trim();
function gameKey(home, away) {
  const lw = s => norm(s).split(" ").slice(-2).join(" ");
  return `${lw(home)}|${lw(away)}`;
}

// ── SportsGameOdds primary ────────────────────────────────────────────────────

function getBestLine(oddsObj, homeOddID, awayOddID) {
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
    .replace(/_MLB$/, "").replace(/_/g, " ")
    .replace(/\b\w/g, c => c.toUpperCase())
    .replace(/\bSt\b/g, "St.").replace(/\bNy\b/g, "NY").replace(/\bLa\b/g, "LA");
}

function buildOddsEntry(homeOdds, awayOdds, homeTeam, awayTeam, commenceTime, id, source) {
  const homeDecimal = americanToDecimal(homeOdds);
  const awayDecimal = americanToDecimal(awayOdds);
  const homeImplied = decimalToImplied(homeDecimal);
  const awayImplied = decimalToImplied(awayDecimal);
  const { fairHome, fairAway } = removeVig(homeImplied, awayImplied);
  return { id, homeTeam, awayTeam, commenceTime, homeOdds, awayOdds, homeImplied: fairHome, awayImplied: fairAway, homeDecimal, awayDecimal, ...(source ? { source } : {}) };
}

// ── The Odds API fallback ─────────────────────────────────────────────────────

async function fetchFromTheOddsAPI(date) {
  if (!TOA_KEY) throw new Error("THE_ODDS_API_KEY not set");
  const url = `${TOA_BASE}/sports/baseball_mlb/odds?apiKey=${TOA_KEY}&regions=us&markets=h2h&oddsFormat=american&dateFormat=iso`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`The Odds API ${res.status}`);
  const events = await res.json();
  if (!Array.isArray(events)) throw new Error("The Odds API unexpected response");

  const results = [];
  for (const event of events) {
    // Filter to the requested date (check UTC and CT)
    const t = new Date(event.commence_time);
    const eventUtcDate = t.toISOString().split("T")[0];
    const eventCtDate  = ctDate(t);
    if (eventUtcDate !== date && eventCtDate !== date) continue;

    const homeTeam = event.home_team;
    const awayTeam = event.away_team;
    if (!homeTeam || !awayTeam) continue;

    // Find best line across priority bookmakers
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
    // If none of the priority books have it, take any available book
    if (!found) found = bookmakers.some(b => tryBk(b.key));
    if (!found || homeOdds == null || awayOdds == null) continue;

    results.push(buildOddsEntry(homeOdds, awayOdds, homeTeam, awayTeam, event.commence_time, event.id, "theoddsapi"));
  }
  console.log(`[odds] The Odds API fallback — ${results.length} games`);
  return results;
}

// ── SportsData.io fallback ────────────────────────────────────────────────────

async function fetchFromSportsData(date) {
  if (!SD_KEY) throw new Error("SPORTSDATA_API_KEY not set");
  const [year, mm, dd] = date.split("-");
  const monthNames = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
  const url = `${SD_BASE}/GamesByDate/${year}-${monthNames[parseInt(mm,10)-1]}-${dd}?key=${SD_KEY}`;

  const etParts = new Intl.DateTimeFormat("en-US", { timeZone:"America/New_York", timeZoneName:"shortOffset" }).formatToParts(new Date(`${date}T12:00:00`));
  const etOffset = (etParts.find(p=>p.type==="timeZoneName")?.value||"GMT-5").includes("-4") ? "-04:00" : "-05:00";

  const res = await fetch(url);
  if (!res.ok) throw new Error(`SportsData.io ${res.status}`);
  const games = await res.json();

  const results = [];
  for (const g of (games || [])) {
    // Include Scheduled, InProgress, and Delayed — skip only Final/Postponed/Cancelled
    if (["Final","F/OT","Postponed","Cancelled","Suspended"].includes(g.Status)) continue;
    const homeTeam = SD_TEAM[g.HomeTeam];
    const awayTeam = SD_TEAM[g.AwayTeam];
    if (!homeTeam || !awayTeam) continue;
    const homeOdds = g.HomeTeamMoneyLine;
    const awayOdds = g.AwayTeamMoneyLine;
    if (!homeOdds || !awayOdds) continue;
    results.push(buildOddsEntry(homeOdds, awayOdds, homeTeam, awayTeam, g.DateTime + etOffset, String(g.GameID), "sportsdata"));
  }
  console.log(`[odds] SportsData.io fallback — ${results.length} games`);
  return results;
}

// ── ESPN scoreboard fallback (free, no key, covers every scheduled game) ─────

async function fetchFromESPN(date) {
  const d = date.replace(/-/g, "");
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

    // ESPN odds — try first provider entry; fall back to any that has moneylines
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

// ── Merge helper: add games from `supplement` not already covered by `base` ──

function mergeOdds(base, supplement) {
  const covered = new Set(base.map(g => gameKey(g.homeTeam, g.awayTeam)));
  const added = supplement.filter(g => !covered.has(gameKey(g.homeTeam, g.awayTeam)));
  if (added.length) console.log(`[odds] supplemented ${added.length} games from secondary source`);
  return [...base, ...added];
}

// Run all three secondary sources in parallel and merge results into base.
// Runs regardless of whether primary succeeded — maximises coverage.
async function supplementAll(base, date) {
  const [toa, sd, espn] = await Promise.allSettled([
    fetchFromTheOddsAPI(date).catch(e => { console.warn("[odds] TOA supplement:", e.message); return []; }),
    fetchFromSportsData(date).catch(e => { console.warn("[odds] SD supplement:", e.message);  return []; }),
    fetchFromESPN(date).catch(e =>       { console.warn("[odds] ESPN supplement:", e.message); return []; }),
  ]);
  let result = base;
  for (const r of [toa, sd, espn]) {
    if (r.status === "fulfilled" && r.value?.length) result = mergeOdds(result, r.value);
  }
  return result;
}

// Module-level cache — shared across requests in the same Vercel instance
let _cache = null;
let _cacheTime = 0;
let _inflight = null;

async function _fetchFresh() {
  const today = ctDate();
  const params = new URLSearchParams({
    leagueID: "MLB",
    oddID: "points-home-game-ml-home,points-away-game-ml-away",
    oddsAvailable: "true",
    limit: "50",
    apiKey: API_KEY,
  });

  const res = await fetch(`${BASE}/events?${params}`);

  // Primary succeeded — supplement all three secondary sources to fill coverage gaps
  if (res.ok) {
    const json = await res.json();
    if (!json?.error || json?.data?.length) {
      const events = json?.data || [];
      let results = [];
      for (const event of events) {
        if (event.status?.started || event.status?.ended) continue;
        const homeTeam = event.teams?.home?.names?.full || cleanTeamName(event.teams?.home?.teamID);
        const awayTeam = event.teams?.away?.names?.full || cleanTeamName(event.teams?.away?.teamID);
        const commenceTime = event.status?.startsAt;
        const eventID = event.eventID;
        if (!homeTeam || !awayTeam || !eventID) continue;
        const line = getBestLine(event.odds, "points-home-game-ml-home", "points-away-game-ml-away");
        if (!line) continue;
        results.push(buildOddsEntry(line.homeOdds, line.awayOdds, homeTeam, awayTeam, commenceTime, eventID));
      }
      results = await supplementAll(results, today);
      _cache = results;
      _cacheTime = Date.now();
      console.log(`[odds] primary + all supplements — ${results.length} games cached`);
      return results;
    }
    console.warn("[odds] primary app-level error:", json?.error);
  } else {
    console.warn(`[odds] primary HTTP ${res.status}`);
  }

  // Primary failed — return stale in-memory cache if fresh enough (< 2h)
  if (_cache && Date.now() - _cacheTime < 2 * 3600 * 1000) {
    console.warn("[odds] primary failed — serving stale in-memory cache");
    return _cache;
  }

  // Primary failed entirely — run all secondary sources
  const fallback = await supplementAll([], today);
  if (fallback.length) return fallback;

  // Last resort: return stale cache regardless of age
  if (_cache) {
    console.warn("[odds] all sources failed — serving stale cache");
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
