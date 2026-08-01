import { weeklyFantasyPoints } from "./scoring.js";

// Recency weights for the last 3 seasons (most-recent first), applied to
// points-per-game rather than season totals so a season shortened by injury
// doesn't get unfairly discounted twice (once here, once by the separate
// injury-availability discount in injury.js). Tunable heuristic — validated
// against real outcomes by the backtest (lib/nfl-fantasy/backtest-runner.js),
// not asserted as fact.
const SEASON_WEIGHTS = [0.55, 0.30, 0.15];

// Position-specific decline curves: RBs decline earliest, QBs latest.
// Also a tunable heuristic pending backtest validation.
const AGING_CURVES = {
  RB: (age) => (age <= 26 ? 1 : Math.max(0.6, 1 - (age - 26) * 0.08)),
  WR: (age) => (age <= 28 ? 1 : Math.max(0.7, 1 - (age - 28) * 0.05)),
  TE: (age) => (age <= 29 ? 1 : Math.max(0.7, 1 - (age - 29) * 0.05)),
  QB: (age) => (age <= 32 ? 1 : Math.max(0.8, 1 - (age - 32) * 0.03)),
};

function agingMultiplier(position, age) {
  if (age == null) return 1;
  const curve = AGING_CURVES[position];
  return curve ? curve(age) : 1;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function percentile(sortedAsc, p) {
  if (!sortedAsc.length) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.round(p * (sortedAsc.length - 1))));
  return sortedAsc[idx];
}

// weeklyGameLogs: every known game for one player, each with a `season`
// field plus the raw stat fields scoring.js reads. asOfSeason is the
// load-bearing param: the live cron calls this with the upcoming season, the
// backtest calls it with the target season, and only games strictly before
// asOfSeason are used — the exact same function serves both, so the backtest
// can never drift from production behavior.
export function buildPlayerProjection(weeklyGameLogs, { asOfSeason, position, age, format = "ppr" }) {
  const bySeason = new Map();
  for (const g of weeklyGameLogs || []) {
    if (g.season == null || g.season >= asOfSeason) continue;
    const arr = bySeason.get(g.season) || [];
    arr.push(g);
    bySeason.set(g.season, arr);
  }

  const seasons = [...bySeason.keys()].sort((a, b) => b - a);
  if (!seasons.length) return null; // no usable history — caller treats as unranked (e.g. rookie)

  const seasonPpg = seasons.map((season) => {
    const games = bySeason.get(season);
    const points = games.map((g) => weeklyFantasyPoints(g, format)).sort((a, b) => a - b);
    const mean = points.reduce((a, b) => a + b, 0) / points.length;
    return { season, gamesPlayed: games.length, mean, points };
  });

  // Recency weight alone lets a single injury-shortened season (e.g. 4 games)
  // dominate the projection just because it's most recent, dragging down both
  // the scoring rate and the games-projected estimate even after the injury
  // has resolved (confirmed case: a back who played 19 full-health games,
  // then 4 injured games, then 19 full-health games again — recency-only
  // weighting mistook the 4-game blip for a real decline). Scaling each
  // season's weight by how much of it was actually played fixes this: a
  // short season still counts, just proportionally to its sample size.
  const relevantSeasons = seasonPpg.slice(0, SEASON_WEIGHTS.length);
  const reliability = relevantSeasons.map((s) => Math.min(1, s.gamesPlayed / 17));

  let weightedSum = 0;
  let weightTotal = 0;
  let weightedGames = 0;
  relevantSeasons.forEach((s, i) => {
    const w = SEASON_WEIGHTS[i] * reliability[i];
    weightedSum += s.mean * w;
    weightedGames += s.gamesPlayed * w;
    weightTotal += w;
  });
  const basePpg = weightTotal > 0 ? weightedSum / weightTotal : 0;
  const adjustedPpg = basePpg * agingMultiplier(position, age);

  const avgGamesPlayed = weightTotal > 0 ? weightedGames / weightTotal : relevantSeasons[0]?.gamesPlayed ?? 0;
  const gamesProjected = Math.min(17, Math.round(avgGamesPlayed));

  // Ceiling/floor derived from the most recent season's per-game spread,
  // expressed as a ratio to that season's mean so it still scales correctly
  // after the aging/recency adjustment above.
  const recent = seasonPpg[0];
  const recentMean = recent.mean || 1;
  const lowRatio = percentile(recent.points, 0.2) / recentMean;
  const highRatio = percentile(recent.points, 0.8) / recentMean;

  return {
    meanPerGame: round2(adjustedPpg),
    mean: round2(adjustedPpg * gamesProjected),
    p20: round2(adjustedPpg * lowRatio * gamesProjected),
    p80: round2(adjustedPpg * highRatio * gamesProjected),
    gamesProjected,
  };
}
