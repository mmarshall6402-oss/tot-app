// Expected-vs-actual regression signal and usage change flags for the
// current, in-progress season — built from the tables
// app/api/cron/nflverse-ingest populates (sql/025_nflverse_daily_ingest.sql).
// Both are "the player pool has more information now than the preseason
// projection did" signals: regression compares realized scoring rate
// against buildPlayerProjection()'s preseason estimate, the change flag
// watches for a usage shift the season-total projection has no way to see
// yet.
import { weeklyFantasyPoints } from "./scoring.js";

// nfl_fantasy_stats_player carries a curated subset of nflverse's raw stat
// components (not the source's own precomputed fantasy_points columns,
// which only cover standard/PPR) — running it back through
// weeklyFantasyPoints() means actual_ppg is scored with exactly the same
// formula buildPlayerProjection() used on historical seasons, so a
// half-PPR regression_delta isn't silently comparing two different scoring
// systems.
export function computeActualStats(statsPlayerRows, format) {
  const byPlayer = new Map();
  for (const row of statsPlayerRows || []) {
    if (!row.player_id) continue;
    const arr = byPlayer.get(row.player_id) || [];
    arr.push(row);
    byPlayer.set(row.player_id, arr);
  }

  const result = new Map();
  for (const [playerId, rows] of byPlayer) {
    const points = rows.map((r) => weeklyFantasyPoints(r, format));
    const gamesPlayed = points.length;
    if (!gamesPlayed) continue;
    const actualPpg = points.reduce((a, b) => a + b, 0) / gamesPlayed;
    result.set(playerId, { actualPpg: Math.round(actualPpg * 100) / 100, gamesPlayed });
  }
  return result;
}

// Positive = outperforming the preseason projection (hot start — often a
// sell-high/regression-risk signal); negative = underperforming (cold
// start relative to what the model expected — often a buy-low candidate).
// Requires a minimum sample so one huge/tiny week doesn't read as a real
// trend.
const REGRESSION_MIN_GAMES = 3;

export function regressionDelta(actualPpg, projectedPpg, gamesPlayed) {
  if (actualPpg == null || projectedPpg == null || gamesPlayed == null || gamesPlayed < REGRESSION_MIN_GAMES) return null;
  return Math.round((actualPpg - projectedPpg) * 100) / 100;
}

// nflverse's offense_pct is a 0-1 fraction of offensive snaps played.
// 15 percentage points of week-over-week swing is well outside normal
// game-to-game noise (a starter's snap share typically holds within a few
// points week to week) and reliably tracks real role changes: a new
// starter, a committee resolving, a rookie taking over.
const SNAP_TREND_THRESHOLD = 0.15;

// Flags a meaningful jump/drop in the most recent week's offense snap share
// versus the player's average in every prior tracked week this season —
// the earliest usage signal available, since role changes show up in snaps
// before they show up in lagging counting stats like targets or carries.
export function computeChangeFlags(snapCountsRows) {
  const byPlayer = new Map();
  for (const row of snapCountsRows || []) {
    if (!row.player_id) continue;
    const arr = byPlayer.get(row.player_id) || [];
    arr.push(row);
    byPlayer.set(row.player_id, arr);
  }

  const result = new Map();
  for (const [playerId, rows] of byPlayer) {
    const sorted = [...rows].sort((a, b) => a.week - b.week);
    if (sorted.length < 2) continue;
    const latest = sorted[sorted.length - 1];
    const prior = sorted.slice(0, -1).filter((r) => r.offense_pct != null);
    if (latest.offense_pct == null || !prior.length) continue;

    const priorAvg = prior.reduce((sum, r) => sum + r.offense_pct, 0) / prior.length;
    const delta = latest.offense_pct - priorAvg;
    if (delta >= SNAP_TREND_THRESHOLD) result.set(playerId, "↑ Snap Share");
    else if (delta <= -SNAP_TREND_THRESHOLD) result.set(playerId, "↓ Snap Share");
  }
  return result;
}
