// lib/backtest/run-weight-tuning.js
//
// Shared core for automated weight tuning — the "actually moves which team
// gets picked" counterpart to lib/backtest/run-recalibration.js. Searches
// the same six top-level factor-scale constants scripts/backtest/tune-weights.js
// searches (PITCHER/LINEUP/BULLPEN/ELO/FORM_DIFF_SCALE, HR_FACTOR_SCALE),
// but blends historical replay rows with live resolved-pick rows via
// searchWeightsFromComponents, and — when write=true — activates whichever
// vector (new candidate or a past one) actually scores best on live picks.
//
// Deliberately more conservative than run-recalibration.js: isotonic
// calibration is monotonic and can only rescale confidence, so it was safe
// to auto-publish a fresh historical+live blend even with very little live
// data. A weight vector can flip which team the model likes — below
// minLiveForSelection, this NEVER auto-activates a new vector, only records
// it as a candidate. The currently active weights are left untouched until
// there's enough live signal to actually compare.

import { searchWeightsFromComponents } from "./weight-search.js";
import { scoreWeightsOnLiveData, pickBestWeights } from "./score-weights.js";
import { getActiveWeights, insertWeights, activateWeightsById, listWeightsWithValues } from "../weights-db.js";

function grid(center, factors) {
  return [...new Set([center, ...factors.map(f => Math.round(center * f * 1e6) / 1e6)])];
}

// Same six top-level blend constants scripts/backtest/tune-weights.js
// searches — keeps the search space small and each change interpretable
// (mirrors that script's own comment on this choice).
function defaultParamSpecs(baseline) {
  return [
    { name: "PITCHER_DIFF_SCALE", candidates: grid(baseline.PITCHER_DIFF_SCALE, [0.6, 0.8, 1.0, 1.2, 1.4]) },
    { name: "LINEUP_DIFF_SCALE",  candidates: grid(baseline.LINEUP_DIFF_SCALE,  [0.6, 0.8, 1.0, 1.2, 1.4]) },
    { name: "BULLPEN_DIFF_SCALE", candidates: grid(baseline.BULLPEN_DIFF_SCALE, [0.6, 0.8, 1.0, 1.2, 1.4]) },
    { name: "ELO_DIFF_SCALE",     candidates: grid(baseline.ELO_DIFF_SCALE,     [0.6, 0.8, 1.0, 1.2, 1.4]) },
    { name: "FORM_DIFF_SCALE",    candidates: grid(baseline.FORM_DIFF_SCALE,    [0.4, 0.7, 1.0, 1.5, 2.0]) },
    { name: "HR_FACTOR_SCALE",    candidates: grid(baseline.HR_FACTOR_SCALE,    [0.4, 0.7, 1.0, 1.5, 2.0]) },
  ];
}

// historicalRows/liveRows: [{components, outcome, season}]
export async function runWeightTuning(supabase, {
  historicalRows,
  liveRows,
  write = false,
  minLiveForSelection = 50,
  source = "manual",
} = {}) {
  const activeWeights = await getActiveWeights(supabase);
  const rows = [...historicalRows, ...liveRows];

  const searchResult = searchWeightsFromComponents({
    rows,
    baseline: activeWeights,
    paramSpecs: defaultParamSpecs(activeWeights),
    passes: 2,
  });

  const result = {
    candidate: searchResult.weights,
    changes: searchResult.changes,
    baselineBrier: searchResult.baselineBrier,
    candidateBrier: searchResult.brier,
    historicalCount: historicalRows.length,
    liveCount: liveRows.length,
    written: false,
  };

  if (!write) return result;

  const notes = `${source}: ${historicalRows.length} historical + ${liveRows.length} live model_picks`;

  // Not enough live signal to trust auto-activating a weight change that can
  // change which team gets picked. Record the candidate for visibility in
  // the history list; leave the active vector exactly as it was.
  if (liveRows.length < minLiveForSelection) {
    const inserted = await insertWeights(supabase, searchResult.weights, "mlb",
      `${notes} — below ${minLiveForSelection}-pick threshold, not activated`, rows.length);
    result.weightsId = inserted.id;
    result.selection = "insufficient-live-data";
    return result;
  }

  const inserted = await insertWeights(supabase, searchResult.weights, "mlb", notes, rows.length);
  const history = await listWeightsWithValues(supabase, "mlb");
  const scored = scoreWeightsOnLiveData(history, liveRows);
  const best = pickBestWeights(scored);

  await activateWeightsById(supabase, best.id, "mlb");

  result.written = true;
  result.weightsId = best.id;
  result.bestLiveBrier = best.liveBrier;
  result.selection = best.id === inserted.id ? "new-fit-is-best" : "kept-past-weights";
  return result;
}
