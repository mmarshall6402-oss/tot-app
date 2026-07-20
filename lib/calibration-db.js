// Isotonic calibration curve read/write, backed by a Supabase model_calibration
// table. Falls back to a seed JSON file when the table has no active row yet.
// Mirrors lib/elo-db.js's read/seed pattern.

import { readFileSync } from "fs";
import { join } from "path";

// Load the active calibration curve from Supabase; seed from the static file
// if no active row exists yet. sport: 'mlb' | 'nfl' (only 'mlb' is fit today).
export async function getCalibrationCurve(supabase, sport = "mlb", seedFile = "data/calibration/mlb_isotonic_v1.json") {
  const { data, error } = await supabase
    .from("model_calibration")
    .select("control_points, fitted_at, train_season_start, train_season_end, game_count, notes")
    .eq("sport", sport)
    .eq("active", true)
    .order("fitted_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (data?.control_points?.length) {
    return { controlPoints: data.control_points, fittedAt: data.fitted_at, gameCount: data.game_count, notes: data.notes };
  }

  // A transient read error is NOT the same as "no active row yet" — re-seeding
  // here would silently overwrite an intentionally-deactivated curve. Only
  // fall through to seeding when the read actually succeeded and came back empty.
  if (error) {
    console.warn(`[calibration] ${sport} read failed, skipping (not re-seeding):`, error.message);
    return null;
  }

  if (!seedFile) return null;

  try {
    const seed = JSON.parse(readFileSync(join(process.cwd(), seedFile), "utf8"));
    await supabase.from("model_calibration").upsert([{
      sport,
      active: true,
      control_points: seed.controlPoints,
      fitted_at: seed.fittedAt ?? new Date().toISOString(),
      train_season_start: seed.trainSeasons?.[0] ?? null,
      train_season_end: seed.trainSeasons?.[seed.trainSeasons.length - 1] ?? null,
      game_count: seed.gameCount ?? null,
      notes: "seeded from " + seedFile,
    }]);
    return seed;
  } catch {
    return null;
  }
}

// Persist a freshly-fit curve (see lib/backtest/calibration-fit.js) as the
// new active row, deactivating any prior active row for the same sport.
// curve: { controlPoints, trainSeasons, gameCount, fittedAt }
export async function setActiveCalibrationCurve(supabase, curve, sport = "mlb", notes = null) {
  await supabase.from("model_calibration").update({ active: false }).eq("sport", sport).eq("active", true);

  const { data, error } = await supabase.from("model_calibration").insert([{
    sport,
    active: true,
    control_points: curve.controlPoints,
    fitted_at: curve.fittedAt ?? new Date().toISOString(),
    train_season_start: curve.trainSeasons?.[0] ?? null,
    train_season_end: curve.trainSeasons?.[curve.trainSeasons.length - 1] ?? null,
    game_count: curve.gameCount ?? null,
    notes,
  }]).select().single();

  if (error) throw error;
  return data;
}

// List past fitted curves (newest first) so an admin can see what each
// day's recalibration produced and, if today's fit looks off, roll back to
// one that's known to work — daily variance in a single day's blended fit
// shouldn't be able to wreck the live model.
export async function listCalibrationCurves(supabase, sport = "mlb", limit = 30) {
  const { data, error } = await supabase
    .from("model_calibration")
    .select("id, fitted_at, game_count, train_season_start, train_season_end, notes, active")
    .eq("sport", sport)
    .order("fitted_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

// Same as listCalibrationCurves but includes control_points (mapped to
// camelCase controlPoints, matching getCalibrationCurve's shape) — needed to
// actually score each past curve against live data (see
// lib/backtest/score-curves.js), not just show its metadata.
export async function listCalibrationCurvesWithPoints(supabase, sport = "mlb", limit = 60) {
  const { data, error } = await supabase
    .from("model_calibration")
    .select("id, fitted_at, game_count, notes, active, control_points")
    .eq("sport", sport)
    .order("fitted_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []).map(row => ({
    id: row.id,
    fittedAt: row.fitted_at,
    gameCount: row.game_count,
    notes: row.notes,
    active: row.active,
    controlPoints: row.control_points,
  }));
}

// Insert a freshly-fit curve as an inactive history row — used when the
// recalibration run wants to record today's fit as a candidate without
// necessarily making it the live curve (see runRecalibration's best-of-all
// selection, lib/backtest/run-recalibration.js).
export async function insertCalibrationCurve(supabase, curve, sport = "mlb", notes = null) {
  const { data, error } = await supabase.from("model_calibration").insert([{
    sport,
    active: false,
    control_points: curve.controlPoints,
    fitted_at: curve.fittedAt ?? new Date().toISOString(),
    train_season_start: curve.trainSeasons?.[0] ?? null,
    train_season_end: curve.trainSeasons?.[curve.trainSeasons.length - 1] ?? null,
    game_count: curve.gameCount ?? null,
    notes,
  }]).select().single();
  if (error) throw error;
  return data;
}

// Re-activate a specific historical row by id — used for "go back to this
// day's calibration" rollback. Does not touch control_points; the row
// already has the exact curve that was live that day.
export async function activateCalibrationCurveById(supabase, id, sport = "mlb") {
  await supabase.from("model_calibration").update({ active: false }).eq("sport", sport).eq("active", true);
  const { data, error } = await supabase
    .from("model_calibration")
    .update({ active: true })
    .eq("id", id)
    .eq("sport", sport)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Whether the daily recalibration cron is allowed to fit+publish a new curve
// for this sport. No row = enabled (default-on, matches pre-toggle behavior).
export async function isAutoRecalibrationEnabled(supabase, sport = "mlb") {
  const { data, error } = await supabase
    .from("model_recalibration_settings")
    .select("auto_enabled")
    .eq("sport", sport)
    .maybeSingle();
  if (error) return true; // table not migrated yet, or transient read error — fail open to today's always-on behavior
  return data?.auto_enabled ?? true;
}

export async function setAutoRecalibrationEnabled(supabase, enabled, sport = "mlb", updatedBy = null) {
  const { error } = await supabase.from("model_recalibration_settings").upsert([{
    sport, auto_enabled: enabled, updated_at: new Date().toISOString(), updated_by: updatedBy,
  }]);
  if (error) throw error;
}
