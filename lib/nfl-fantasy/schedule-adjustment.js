// Folds uploaded schedule-difficulty data for the fantasy playoff weeks
// (15-17 — when a tough or easy stretch actually decides a season) directly
// into the ranking number, per explicit request. Unlike the Sleeper
// trending-adds signal, there's no historical data to backtest this
// against, so this is a documented, accepted-risk heuristic rather than a
// validated one — kept deliberately modest (a few points of ceilingVorp,
// not enough to override a real talent gap on its own).
import { normalizeName } from "./id-map.js";
import { assignTiers } from "./tiers.js";

const PLAYOFF_WEEKS = [15, 16, 17];
const DIFFICULTY_SCORE = { easy: 1, neutral: 0, hard: -1, bye: -1 };
const SCHEDULE_ADJUSTMENT_SCALE = 5;

// scheduleRows: raw rows from nfl_fantasy_schedule_difficulty (player_name,
// week, difficulty). Returns a normalized-name -> point-adjustment map.
export function buildScheduleAdjustmentByName(scheduleRows) {
  const scoresByName = new Map();
  for (const row of scheduleRows || []) {
    if (!PLAYOFF_WEEKS.includes(row.week)) continue;
    const key = normalizeName(row.player_name);
    const arr = scoresByName.get(key) || [];
    arr.push(DIFFICULTY_SCORE[row.difficulty] ?? 0);
    scoresByName.set(key, arr);
  }

  const adjustmentByName = new Map();
  for (const [key, scores] of scoresByName) {
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    adjustmentByName.set(key, avg * SCHEDULE_ADJUSTMENT_SCALE);
  }
  return adjustmentByName;
}

export function scheduleAdjustmentFor(playerName, adjustmentByName) {
  return adjustmentByName.get(normalizeName(playerName)) || 0;
}

// Applies the adjustment, then re-sorts and re-assigns tiers/overall rank so
// the reordering is fully reflected — not just a cosmetic number bump.
export function applyScheduleAdjustment(ranked, adjustmentByName) {
  const adjusted = ranked.map((p) => {
    const scheduleAdjustment = scheduleAdjustmentFor(p.name, adjustmentByName);
    return { ...p, ceilingVorp: p.ceilingVorp + scheduleAdjustment, scheduleAdjustment };
  });
  adjusted.sort((a, b) => b.ceilingVorp - a.ceilingVorp);
  return assignTiers(adjusted).map((p, i) => ({ ...p, rankOverall: i + 1 }));
}
