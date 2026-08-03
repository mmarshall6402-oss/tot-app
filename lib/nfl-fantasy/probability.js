// Turns two nfl_fantasy_rankings rows into a single-week head-to-head start
// probability. This is the "63%, not WR14" piece: everything else in
// lib/nfl-fantasy computes a season-long projection/VORP for the cheat
// sheet, but a start/sit call is a one-game question, so this module
// derives a per-game distribution from the stored season totals and scores
// P(playerA outscores playerB) this week — a real, falsifiable number
// instead of an LLM's confidence adjective.
import { STATUS_MULTIPLIER } from "./injury.js";

// Inverse standard-normal CDF at p=0.8 — project.js's p20/p80 ceiling/floor
// ratios are 20th/80th percentiles, so this converts that spread back into
// a standard deviation.
const Z80 = 0.8416212335729143;

// Floor on per-game spread so a thin sample (e.g. a single strong season)
// doesn't collapse the distribution to near-zero variance and produce a
// falsely extreme probability.
const MIN_SD = 0.75;

// Clamp displayed probability away from the extremes — a model built on
// season-level projections and a normal approximation shouldn't ever claim
// 99.9% confidence on a single game.
const PROB_FLOOR = 0.02;
const PROB_CEIL = 0.98;

function round1(n) {
  return Math.round(n * 10) / 10;
}

// Abramowitz & Stegun 7.1.26 approximation, accurate to ~1.5e-7.
function erf(x) {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const t = 1 / (1 + p * ax);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return sign * y;
}

function normalCdf(z) {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

// row: a nfl_fantasy_rankings-shaped object (see lib/nfl-fantasy/lookup.js's
// COLUMNS) — projected/ceiling/floor_points are season totals, games_projected
// is the games count that produced them (sql/016), so dividing recovers a
// per-game rate consistent with the stored totals. injury_status is this
// week's live designation, not the season-long durability discount baked
// into the totals, so it's applied here as a separate multiplier.
function weeklyDistribution(row) {
  const games = row?.games_projected;
  if (!row || !games || games <= 0 || row.projected_points == null) return null;

  const mean = row.projected_points / games;
  const ceiling = (row.ceiling_points ?? row.projected_points) / games;
  const floor = (row.floor_points ?? row.projected_points) / games;
  const sd = Math.max(MIN_SD, (ceiling - floor) / (2 * Z80));
  const statusMultiplier = STATUS_MULTIPLIER[(row.injury_status || "").toLowerCase()] ?? 1;

  return { mean, ceiling, floor, sd, statusMultiplier, adjustedMean: mean * statusMultiplier };
}

function buildFactors(rowA, rowB, distA, distB) {
  const factors = [];

  const meanGap = distA.mean - distB.mean;
  if (Math.abs(meanGap) >= 0.1) {
    const leader = meanGap > 0 ? rowA.name : rowB.name;
    factors.push(`${leader} projects for ${Math.abs(meanGap).toFixed(1)} more pts/game this week`);
  }

  if (rowA.tier != null && rowB.tier != null && rowA.tier !== rowB.tier) {
    const better = rowA.tier < rowB.tier ? rowA.name : rowB.name; // lower tier number = better
    factors.push(`${better} sits in a stronger tier (Tier ${Math.min(rowA.tier, rowB.tier)})`);
  }

  if (distA.statusMultiplier < 1) factors.push(`${rowA.name} is listed ${rowA.injury_status} this week`);
  if (distB.statusMultiplier < 1) factors.push(`${rowB.name} is listed ${rowB.injury_status} this week`);

  return factors.slice(0, 3);
}

// Returns null when either player lacks a usable season projection (no
// nfl_fantasy_rankings row, or games_projected missing/zero) — caller
// degrades to the plain LLM verdict with no probability attached, same
// graceful-miss posture as the rest of this feature.
export function headToHeadProbability(rowA, rowB) {
  const distA = weeklyDistribution(rowA);
  const distB = weeklyDistribution(rowB);
  if (!distA || !distB) return null;

  const diffMean = distA.adjustedMean - distB.adjustedMean;
  const diffSd = Math.sqrt(distA.sd ** 2 + distB.sd ** 2) || MIN_SD;
  const z = diffMean / diffSd;
  const probA = Math.min(PROB_CEIL, Math.max(PROB_FLOOR, normalCdf(z)));

  return {
    playerAProbability: round1(probA * 100),
    playerBProbability: round1((1 - probA) * 100),
    startPlayer: probA >= 0.5 ? "A" : "B",
    factors: buildFactors(rowA, rowB, distA, distB),
    perGame: {
      a: { mean: round1(distA.mean), floor: round1(distA.floor), ceiling: round1(distA.ceiling) },
      b: { mean: round1(distB.mean), floor: round1(distB.floor), ceiling: round1(distB.ceiling) },
    },
  };
}
