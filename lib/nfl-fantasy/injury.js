// Blends this-week's ESPN injury designation (from lib/nfl-roster.js) with a
// longer-run durability signal (fraction of games missed historically) into
// a single games-available discount — a "questionable" label this week
// matters less for a draft cheat sheet than a player who's missed 30% of
// games over the last 2 seasons.
// Exported for reuse by lib/nfl-fantasy/probability.js, which applies the
// same this-week designation to a single game's expected points rather than
// a season's worth of games.
export const STATUS_MULTIPLIER = {
  out: 0,
  ir: 0,
  suspended: 0,
  doubtful: 0.25,
  questionable: 0.85,
};

// Live depth-chart position (Sleeper) — a backup projected off last season's
// usage overstates his expected games-as-starter unless he's actually moved
// up the chart. Tunable heuristic like the rest of this module, not asserted
// as fact. depthChartOrder === 1 is the starter (no discount); unknown
// (Sleeper miss / not on Sleeper's chart yet) also gets no discount rather
// than penalizing a live-data gap.
const DEPTH_CHART_MULTIPLIER = { 1: 1, 2: 0.6, 3: 0.35 };
const DEEP_BENCH_MULTIPLIER = 0.2; // depthChartOrder >= 4

function depthChartMultiplier(depthChartOrder) {
  if (depthChartOrder == null) return 1;
  return DEPTH_CHART_MULTIPLIER[depthChartOrder] ?? DEEP_BENCH_MULTIPLIER;
}

export function injuryAdjustedGames(gamesProjected, { currentStatus, historicalGamesMissedRate = 0, depthChartOrder } = {}) {
  const statusMultiplier = STATUS_MULTIPLIER[(currentStatus || "").toLowerCase()] ?? 1;
  const durabilityMultiplier = Math.max(0.5, 1 - historicalGamesMissedRate);
  const depthMultiplier = depthChartMultiplier(depthChartOrder);
  return Math.round(gamesProjected * statusMultiplier * durabilityMultiplier * depthMultiplier * 10) / 10;
}

export function classifyInjuryRisk(historicalGamesMissedRate) {
  if (historicalGamesMissedRate >= 0.3) return "high";
  if (historicalGamesMissedRate >= 0.15) return "medium";
  return "low";
}
