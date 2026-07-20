// lib/backtest/live-picks.js
//
// Pulls resolved model_picks rows — the same production prediction-vs-outcome
// data app/api/calibration/route.js reads to build the calibration dashboard
// (recap of how well the model's probabilities have actually tracked
// outcomes) — and reshapes them into the {modelProb, outcome, season} row
// format lib/backtest/calibration-fit.js expects. This is what lets
// recalibration learn from picks the model has actually made in production,
// not just the offline historical replay in data/games.json.
//
// MLB only — model_picks has no sport column (NFL picks live in a separate
// nfl_model_picks table), matching lib/calibration-db.js's "only 'mlb' is
// fit today" note.

export async function fetchLiveCalibrationRows(supabase) {
  const { data, error } = await supabase
    .from("model_picks")
    .select("date, result, features")
    .in("result", ["win", "loss"]);

  if (error || !data?.length) return [];

  return data
    .filter(r => r.features?.true_win_prob_pct != null)
    .map(r => ({
      modelProb: r.features.true_win_prob_pct / 100,
      outcome: r.result === "win" ? 1 : 0,
      season: r.date.slice(0, 4),
    }));
}
