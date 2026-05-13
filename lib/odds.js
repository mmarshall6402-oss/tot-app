import { americanToDecimal, decimalToImplied, removeVig } from "./edge.js";

const API_KEY = process.env.SPORTSGAMEODDS_API_KEY;
const BASE = "https://api.sportsgameodds.com/v2";

const BOOKMAKER_PRIORITY = ["pinnacle", "circa", "betonline", "draftkings", "fanduel", "caesars", "betmgm", "bet365"];

// Convert raw API team IDs to clean display names
// e.g. "CLEVELAND_GUARDIANS_MLB" → "Cleveland Guardians"
function cleanTeamName(rawID) {
  if (!rawID) return rawID;
  return rawID
    .replace(/_MLB$/, "")        // remove trailing _MLB
    .replace(/_/g, " ")          // underscores → spaces
    .replace(/\b\w/g, c => c.toUpperCase()) // Title Case each word
    .replace(/\bSt\b/g, "St.")   // fix St Louis
    .replace(/\bNy\b/g, "NY")    // fix NY teams
    .replace(/\bLa\b/g, "LA");   // fix LA teams
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

export async function fetchMLBOdds() {
  const params = new URLSearchParams({
    leagueID: "MLB",
    oddID: "points-home-game-ml-home,points-away-game-ml-away",
    oddsAvailable: "true",
    limit: "30",
    apiKey: API_KEY,
  });

  const res = await fetch(`${BASE}/events?${params}`);
  if (!res.ok) throw new Error(`SportsGameOdds fetch failed: ${res.status}`);

  const json = await res.json();
  const events = json?.data || [];

  const results = [];

  for (const event of events) {
    if (event.status?.started || event.status?.ended) continue;

    // Use clean name from API if available, otherwise clean the raw ID
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
      id: eventID,
      homeTeam,
      awayTeam,
      commenceTime,
      homeOdds,
      awayOdds,
      homeImplied: fairHome,
      awayImplied: fairAway,
      homeDecimal,
      awayDecimal,
    });
  }

  return results;
}
