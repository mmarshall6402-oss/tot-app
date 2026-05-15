import { americanToDecimal, decimalToImplied, removeVig } from "./edge.js";

const API_KEY = process.env.SPORTSGAMEODDS_API_KEY;
const BASE = "https://api.sportsgameodds.com/v2";
const TTL = 1000 * 60 * 15; // 15 minutes

// SportsData.io — used as fallback when primary API is rate-limited
const SD_KEY  = process.env.SPORTSDATA_API_KEY;
const SD_BASE = "https://api.sportsdata.io/v3/mlb/scores/json";

// SportsData.io uses 3-letter team keys; map to canonical full names
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
  CIN:"Cincinnati Reds",ATH:"Oakland Athletics",WSH:"Washington Nationals",
};

async function fetchFromSportsData(date) {
  if (!SD_KEY) throw new Error("SPORTSDATA_API_KEY not set");
  // Parse YYYY-MM-DD directly to avoid timezone offset shifting the date
  const [year, mm, dd] = date.split("-");
  const monthNames = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
  const month = monthNames[parseInt(mm, 10) - 1];
  const day   = dd;
  const url   = `${SD_BASE}/GamesByDate/${year}-${month}-${day}?key=${SD_KEY}`;

  const res  = await fetch(url);
  if (!res.ok) throw new Error(`SportsData.io ${res.status}`);
  const games = await res.json();

  const results = [];
  for (const g of (games || [])) {
    if (g.Status !== "Scheduled" && g.Status !== "InProgress") continue;
    const homeTeam = SD_TEAM[g.HomeTeam];
    const awayTeam = SD_TEAM[g.AwayTeam];
    if (!homeTeam || !awayTeam) continue;
    const homeOdds = g.HomeTeamMoneyLine;
    const awayOdds = g.AwayTeamMoneyLine;
    if (!homeOdds || !awayOdds) continue;
    const homeDecimal = americanToDecimal(homeOdds);
    const awayDecimal = americanToDecimal(awayOdds);
    const homeImplied = decimalToImplied(homeDecimal);
    const awayImplied = decimalToImplied(awayDecimal);
    const { fairHome, fairAway } = removeVig(homeImplied, awayImplied);
    results.push({
      id: String(g.GameID), homeTeam, awayTeam,
      commenceTime: g.DateTime + "Z",
      homeOdds, awayOdds,
      homeImplied: fairHome, awayImplied: fairAway,
      homeDecimal, awayDecimal,
      source: "sportsdata",
    });
  }
  console.log(`[odds] SportsData.io fallback — ${results.length} games`);
  return results;
}

const BOOKMAKER_PRIORITY = ["pinnacle", "circa", "betonline", "draftkings", "fanduel", "caesars", "betmgm", "bet365"];

// Module-level cache — shared across requests in the same process
let _cache = null;
let _cacheTime = 0;
let _inflight = null; // dedupe simultaneous requests

function cleanTeamName(rawID) {
  if (!rawID) return rawID;
  return rawID
    .replace(/_MLB$/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, c => c.toUpperCase())
    .replace(/\bSt\b/g, "St.")
    .replace(/\bNy\b/g, "NY")
    .replace(/\bLa\b/g, "LA");
}

function getBestLine(oddsObj, homeOddID, awayOddID) {
  const homeMarket = oddsObj?.[homeOddID]?.byBookmaker;
  const awayMarket = oddsObj?.[awayOddID]?.byBookmaker;
  if (!homeMarket || !awayMarket) return null;

  for (const bk of BOOKMAKER_PRIORITY) {
    const home = homeMarket[bk];
    const away = awayMarket[bk];
    if (!home?.available || !away?.available) continue;
    if (!home?.odds || !away?.odds) continue;
    const homeOdds = parseInt(home.odds, 10);
    const awayOdds = parseInt(away.odds, 10);
    if (isNaN(homeOdds) || isNaN(awayOdds)) continue;
    if (homeOdds === 0 || awayOdds === 0) continue;
    return { homeOdds, awayOdds, bookmaker: bk };
  }
  return null;
}

async function _fetchFresh() {
  const params = new URLSearchParams({
    leagueID: "MLB",
    oddID: "points-home-game-ml-home,points-away-game-ml-away",
    oddsAvailable: "true",
    limit: "30",
    apiKey: API_KEY,
  });

  const res = await fetch(`${BASE}/events?${params}`);

  if (!res.ok) {
    if (_cache) {
      console.warn(`[odds] ${res.status} — returning stale in-memory cache`);
      return _cache;
    }
    console.warn(`[odds] SportsGameOdds ${res.status} — trying SportsData.io fallback`);
    return fetchFromSportsData(new Date().toISOString().split("T")[0]);
  }

  const json = await res.json();
  if (json?.error && !json?.data?.length) {
    if (_cache) {
      console.warn("[odds] app-level error, returning stale cache:", json.error);
      return _cache;
    }
    console.warn("[odds] app-level error — trying SportsData.io fallback:", json.error);
    return fetchFromSportsData(new Date().toISOString().split("T")[0]);
  }
  const events = json?.data || [];
  const results = [];

  for (const event of events) {
    if (event.status?.started || event.status?.ended) continue;

    const rawHome = event.teams?.home?.teamID;
    const rawAway = event.teams?.away?.teamID;
    const homeTeam = event.teams?.home?.names?.full || cleanTeamName(rawHome);
    const awayTeam = event.teams?.away?.names?.full || cleanTeamName(rawAway);
    const commenceTime = event.status?.startsAt;
    const eventID = event.eventID;

    if (!homeTeam || !awayTeam || !eventID) continue;

    const line = getBestLine(
      event.odds,
      "points-home-game-ml-home",
      "points-away-game-ml-away"
    );
    if (!line) continue;

    const { homeOdds, awayOdds } = line;
    const homeDecimal = americanToDecimal(homeOdds);
    const awayDecimal = americanToDecimal(awayOdds);
    const homeImplied = decimalToImplied(homeDecimal);
    const awayImplied = decimalToImplied(awayDecimal);
    const { fairHome, fairAway } = removeVig(homeImplied, awayImplied);

    results.push({
      id: eventID, homeTeam, awayTeam, commenceTime,
      homeOdds, awayOdds,
      homeImplied: fairHome, awayImplied: fairAway,
      homeDecimal, awayDecimal,
    });
  }

  _cache = results;
  _cacheTime = Date.now();
  console.log(`[odds] fetched fresh — ${results.length} games cached`);
  return results;
}

export async function fetchMLBOdds() {
  // Cache hit
  if (_cache && Date.now() - _cacheTime < TTL) {
    console.log("[odds] cache hit");
    return _cache;
  }

  // Dedupe: if a fetch is already in flight, wait for it instead of firing another
  if (_inflight) {
    console.log("[odds] deduped — waiting on inflight request");
    return _inflight;
  }

  _inflight = _fetchFresh().finally(() => { _inflight = null; });
  return _inflight;
}
