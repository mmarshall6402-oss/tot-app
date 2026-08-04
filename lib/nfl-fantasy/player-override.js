// Manual admin hand-tuning (app/admin/players) — an override here replaces
// the model's projection outright rather than nudging ceilingVorp like
// personnel/pace/playcaller adjustment.js do, since the point of a hand-tune
// is "this is the real number," not "shade the model's number a little."
// Applied last in app/api/cron/nfl-fantasy-rankings/route.js, after every
// other adjustment, so it's always the final word for that player.
import { assignTiers } from "./tiers.js";
import { computeVorp } from "./vorp.js";

function round2(n) {
  return Math.round(n * 100) / 100;
}

// rows: raw rows from nfl_player_overrides (sql/017_nfl_player_overrides.sql).
// Returns a playerId -> { meanPoints, floorPoints, ceilingPoints, note } map.
export function buildPlayerOverridesById(rows) {
  const byId = new Map();
  for (const row of rows || []) {
    if (!row.player_id) continue;
    const meanPoints = row.mean_points != null ? Number(row.mean_points) : null;
    const floorPoints = row.floor_points != null ? Number(row.floor_points) : null;
    const ceilingPoints = row.ceiling_points != null ? Number(row.ceiling_points) : null;
    if (meanPoints == null && floorPoints == null && ceilingPoints == null) continue;
    byId.set(row.player_id, { meanPoints, floorPoints, ceilingPoints, note: row.note || null });
  }
  return byId;
}

// Re-sorts and re-assigns tiers/overall rank afterward, same as the other
// ranking adjustments, so the reordering an override causes is fully
// reflected rather than just a cosmetic number bump.
export function applyPlayerOverrides(ranked, overridesById, vorpOptions) {
  if (!overridesById || !overridesById.size) return ranked.map((p) => ({ ...p, manualOverrideNote: null }));

  const adjusted = ranked.map((p) => {
    const override = overridesById.get(p.playerId);
    if (!override) return { ...p, manualOverrideNote: null };

    const games = p.projection.gamesProjected || 0;
    const mean = override.meanPoints ?? p.projection.mean;
    const p20 = override.floorPoints ?? p.projection.p20;
    const p80 = override.ceilingPoints ?? p.projection.p80;

    const projection = {
      ...p.projection,
      mean: round2(mean),
      p20: round2(p20),
      p80: round2(p80),
      meanPerGame: games ? round2(mean / games) : p.projection.meanPerGame,
    };

    const { vorp, ceilingVorp } = computeVorp(projection, p.replacementPoints, vorpOptions);
    return { ...p, projection, vorp, ceilingVorp, manualOverrideNote: override.note || "Hand-tuned" };
  });

  adjusted.sort((a, b) => b.ceilingVorp - a.ceilingVorp);
  return assignTiers(adjusted).map((p, i) => ({ ...p, rankOverall: i + 1 }));
}
