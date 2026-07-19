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
    .select("control_points, fitted_at, train_season_start, train_season_end, game_count")
    .eq("sport", sport)
    .eq("active", true)
    .order("fitted_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (data?.control_points?.length) {
    return { controlPoints: data.control_points, fittedAt: data.fitted_at, gameCount: data.game_count };
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
