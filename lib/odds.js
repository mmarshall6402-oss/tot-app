import { americanToDecimal, decimalToImplied, removeVig } from "./edge.js";

const API_KEY = process.env.SPORTSGAMEODDS_API_KEY;
const BASE = "https://api.sportsgameodds.com/v2";

// Bookmakers in priority order (sharpest first)
const BOOKMAKER_PRIORITY = ["pinnacle", "circa", "betonline", "draftkings", "fanduel", "caesars", "betmgm", "bet365"];

// Pick the sharpest available moneyline from bookmakers
function getBestLine(oddsObj, homeOddID, awayOddID) {
  const homeMarket = oddsObj?.[homeOddID]?.byBookmaker;
  const awayMarket = oddsObj?.[awayOddID]?.byBookmaker;

  if (!homeMarket || !awayMarket) return null;

  for (const bk of BOOKMAKER_PRIORITY) {
    const home = homeMarket[bk];
    const away = awayMarket[bk];

    // Silent filter: skip if unavailable or missing
    if (!home?.available || !away?.available) continue;
    if (!home?.odds || !away?.odds) continue;

    const homeOdds = parseInt(home.odds, 10);
    const awayOdds = parseInt(away.odds, 10);

    // Silent filter: skip clearly invalid odds
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
    // Silent filter: skip started or ended games
    if (event.status?.started || event.status?.ended) continue;

    const homeTeam = event.teams?.home?.names?.full || event.teams?.home?.teamID;
    const awayTeam = event.teams?.away?.names?.full || event.teams?.away?.teamID;
    const commenceTime = event.status?.startsAt;
    const eventID = event.eventID;

    // Silent filter: skip if team names missing
    if (!homeTeam || !awayTeam || !eventID) continue;

    const line = getBestLine(
      event.odds,
      "points-home-game-ml-home",
      "points-away-game-ml-away"
    );

    // Silent filter: skip if no valid moneyline pair found
    if (!line) continue;

    const { homeOdds, awayOdds } = line;

    // Convert American → decimal → implied probability
    const homeDecimal = americanToDecimal(homeOdds);
    const awayDecimal = americanToDecimal(awayOdds);
    const homeImplied = decimalToImplied(homeDecimal);
    const awayImplied = decimalToImplied(awayDecimal);

    // Remove vig for fair probabilities
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
