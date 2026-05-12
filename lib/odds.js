import { americanToDecimal, decimalToImplied, removeVig } from "./edge.js";

const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;
const BASE = "https://odds-api1.p.rapidapi.com";
const MLB_TOURNAMENT_ID = 109;

const HEADERS = {
  "x-rapidapi-key": RAPIDAPI_KEY,
  "x-rapidapi-host": "odds-api1.p.rapidapi.com",
  "Content-Type": "application/json",
};

// Convert decimal odds (European) to American odds
function decimalToAmerican(decimal) {
  if (decimal >= 2.0) return Math.round((decimal - 1) * 100);
  return Math.round(-100 / (decimal - 1));
}

// Pick the best (sharpest) moneyline from available bookmakers
// Sharpest = closest to 50/50 (lowest vig), most efficient market
function getBestMoneyline(bookmakers, participant1Id, participant2Id) {
  let bestHome = null;
  let bestAway = null;
  let lowestVig = Infinity;
  const seen = new Set();

  for (const bk of bookmakers) {
    // Skip duplicate bookmaker entries
    if (seen.has(bk.bookmakerId)) continue;
    seen.add(bk.bookmakerId);

    const markets = bk.markets || {};
    // Look for moneyline market (key variations: "1x2", "moneyline", "h2h", "2way")
    const ml =
      markets["moneyline"] ||
      markets["2way"] ||
      markets["h2h"] ||
      markets["1x2"] ||
      null;

    if (!ml) continue;

    const homeOdds = ml[participant1Id] ?? ml["1"] ?? null;
    const awayOdds = ml[participant2Id] ?? ml["2"] ?? null;

    // Silent filter: skip if either side is missing
    if (homeOdds == null || awayOdds == null) continue;

    // Skip clearly invalid odds (decimal must be > 1.0)
    if (homeOdds <= 1.0 || awayOdds <= 1.0) continue;

    // Calculate vig to find sharpest book
    const homeImpl = decimalToImplied(homeOdds);
    const awayImpl = decimalToImplied(awayOdds);
    const vig = homeImpl + awayImpl - 1;

    if (vig < lowestVig) {
      lowestVig = vig;
      bestHome = homeOdds;
      bestAway = awayOdds;
    }
  }

  return { bestHome, bestAway };
}

export async function fetchMLBOdds() {
  // Step 1: Get today's fixtures, filtered to MLB
  const fixturesRes = await fetch(
    `${BASE}/fixtures/today?sportId=13&tournamentId=${MLB_TOURNAMENT_ID}`,
    { headers: HEADERS }
  );

  if (!fixturesRes.ok) {
    throw new Error(`Fixtures fetch failed: ${fixturesRes.status}`);
  }

  const fixturesData = await fixturesRes.json();
  const fixtures = Array.isArray(fixturesData) ? fixturesData : fixturesData.data || [];

  // Silent filter: only Pre-Game MLB fixtures
  const mlbFixtures = fixtures.filter(
    (f) =>
      f.tournament?.tournamentId === MLB_TOURNAMENT_ID &&
      f.status?.statusName === "Pre-Game"
  );

  if (!mlbFixtures.length) return [];

  // Step 2: Fetch odds for all MLB fixture IDs in one call
  const fixtureIds = mlbFixtures.map((f) => f.fixtureId).join(",");

  const oddsRes = await fetch(
    `${BASE}/fixtures/odds?fixtureIds=${fixtureIds}&bookmakers=pinnacle,draftkings,fanduel,betmgm,caesars`,
    { headers: HEADERS }
  );

  if (!oddsRes.ok) {
    throw new Error(`Odds fetch failed: ${oddsRes.status}`);
  }

  const oddsData = await oddsRes.json();
  const oddsArray = Array.isArray(oddsData) ? oddsData : oddsData.data || [];

  // Build a map of fixtureId -> odds entry for fast lookup
  const oddsMap = new Map();
  for (const entry of oddsArray) {
    oddsMap.set(entry.fixtureId, entry);
  }

  // Step 3: Build normalized output, applying all silent filters
  const results = [];

  for (const fixture of mlbFixtures) {
    const p1Id = fixture.participants?.participant1Id;
    const p2Id = fixture.participants?.participant2Id;
    const homeTeam = fixture.participants?.participant1Name;
    const awayTeam = fixture.participants?.participant2Name;
    const commenceTime = new Date(fixture.startTime * 1000).toISOString();
    const fixtureId = fixture.fixtureId;

    // Silent filter: skip if participant data is incomplete
    if (!p1Id || !p2Id || !homeTeam || !awayTeam) continue;

    const oddsEntry = oddsMap.get(fixtureId);

    // Silent filter: skip if no odds data at all
    if (!oddsEntry) continue;

    const bookmakers = oddsEntry.bookmakers || [];

    // Silent filter: skip if no bookmakers attached
    if (!bookmakers.length) continue;

    const { bestHome, bestAway } = getBestMoneyline(bookmakers, p1Id, p2Id);

    // Silent filter: skip if moneyline pair is incomplete
    if (bestHome == null || bestAway == null) continue;

    // Convert decimal odds to American
    const homeOdds = decimalToAmerican(bestHome);
    const awayOdds = decimalToAmerican(bestAway);

    // Implied probabilities + vig removal
    const homeDecimal = bestHome;
    const awayDecimal = bestAway;
    const homeImplied = decimalToImplied(homeDecimal);
    const awayImplied = decimalToImplied(awayDecimal);
    const { fairHome, fairAway } = removeVig(homeImplied, awayImplied);

    results.push({
      id: fixtureId,
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
