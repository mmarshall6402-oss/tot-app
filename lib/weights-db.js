// Live WEIGHTS vector read/write, backed by a Supabase model_weights table —
// same read/seed/history/rollback pattern as lib/calibration-db.js, applied
// to the actual predictive factor weights (lib/probability.js's WEIGHTS)
// instead of the isotonic calibration curve. A row here can change which
// team the model picks, not just how confident it sounds — see
// lib/backtest/run-weight-tuning.js for the guarded selection logic.

import { WEIGHTS } from "./probability.js";

// Load the active weight vector from Supabase; seed from the current
// hardcoded WEIGHTS defaults if no active row exists yet. Returns a plain
// object suitable for setWeights() — never null, so callers don't need a
// separate "no override" branch.
export async function getActiveWeights(supabase, sport = "mlb") {
  const { data, error } = await supabase
    .from("model_weights")
    .select("weights, fitted_at, game_count, notes")
    .eq("sport", sport)
    .eq("active", true)
    .order("fitted_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (data?.weights) return data.weights;

  // Transient read error: fall back to hardcoded defaults for this request
  // rather than seeding — don't want a blip to overwrite an intentionally
  // deactivated row's absence with a fresh seed.
  if (error) {
    console.warn(`[weights] ${sport} read failed, using hardcoded defaults:`, error.message);
    return { ...WEIGHTS };
  }

  await supabase.from("model_weights").upsert([{
    sport, active: true, weights: WEIGHTS, fitted_at: new Date().toISOString(), notes: "seeded from lib/probability.js defaults",
  }]);
  return { ...WEIGHTS };
}

// Insert a freshly-fit vector as an inactive history row — mirrors
// insertCalibrationCurve; used by the best-of-all selection in
// lib/backtest/run-weight-tuning.js.
export async function insertWeights(supabase, weights, sport = "mlb", notes = null, gameCount = null) {
  const { data, error } = await supabase.from("model_weights").insert([{
    sport, active: false, weights, fitted_at: new Date().toISOString(), game_count: gameCount, notes,
  }]).select().single();
  if (error) throw error;
  return data;
}

export async function listWeightsWithValues(supabase, sport = "mlb", limit = 60) {
  const { data, error } = await supabase
    .from("model_weights")
    .select("id, fitted_at, game_count, notes, active, weights")
    .eq("sport", sport)
    .order("fitted_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

export async function listWeights(supabase, sport = "mlb", limit = 30) {
  const { data, error } = await supabase
    .from("model_weights")
    .select("id, fitted_at, game_count, notes, active")
    .eq("sport", sport)
    .order("fitted_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

export async function activateWeightsById(supabase, id, sport = "mlb") {
  await supabase.from("model_weights").update({ active: false }).eq("sport", sport).eq("active", true);
  const { data, error } = await supabase
    .from("model_weights")
    .update({ active: true })
    .eq("id", id)
    .eq("sport", sport)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Separate on/off switch from calibration's — you might want live weight
// re-tuning paused while calibration keeps running, or vice versa.
export async function isAutoWeightTuningEnabled(supabase, sport = "mlb") {
  const { data, error } = await supabase
    .from("model_recalibration_settings")
    .select("auto_weights_enabled")
    .eq("sport", sport)
    .maybeSingle();
  if (error) return true; // table/column not migrated yet — fail open
  return data?.auto_weights_enabled ?? true;
}

export async function setAutoWeightTuningEnabled(supabase, enabled, sport = "mlb", updatedBy = null) {
  const { error } = await supabase.from("model_recalibration_settings").upsert([{
    sport, auto_weights_enabled: enabled, updated_at: new Date().toISOString(), updated_by: updatedBy,
  }]);
  if (error) throw error;
}
