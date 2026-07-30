// Blends this-week's ESPN injury designation (from lib/nfl-roster.js) with a
// longer-run durability signal (fraction of games missed historically) into
// a single games-available discount — a "questionable" label this week
// matters less for a draft cheat sheet than a player who's missed 30% of
// games over the last 2 seasons.
const STATUS_MULTIPLIER = {
  out: 0,
  ir: 0,
  suspended: 0,
  doubtful: 0.25,
  questionable: 0.85,
};

export function injuryAdjustedGames(gamesProjected, { currentStatus, historicalGamesMissedRate = 0 } = {}) {
  const statusMultiplier = STATUS_MULTIPLIER[(currentStatus || "").toLowerCase()] ?? 1;
  const durabilityMultiplier = Math.max(0.5, 1 - historicalGamesMissedRate);
  return Math.round(gamesProjected * statusMultiplier * durabilityMultiplier * 10) / 10;
}

export function classifyInjuryRisk(historicalGamesMissedRate) {
  if (historicalGamesMissedRate >= 0.3) return "high";
  if (historicalGamesMissedRate >= 0.15) return "medium";
  return "low";
}
