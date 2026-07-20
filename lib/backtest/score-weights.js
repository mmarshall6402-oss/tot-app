// lib/backtest/score-weights.js
//
// Scores a set of WEIGHTS vectors (past fits from model_weights, or a brand
// new candidate) against real live picks by Brier score — same role as
// lib/backtest/score-curves.js plays for calibration curves, applied to full
// predictive weight vectors instead of a single isotonic curve.

import { brierScore } from "./metrics.js";
import { computeProbabilityFromComponents } from "../probability.js";

// vectors: [{ id, weights, ... }] — extra fields pass through untouched.
// liveRows: [{ components, outcome }]
export function scoreWeightsOnLiveData(vectors, liveRows) {
  return vectors.map(v => {
    const preds = liveRows.map(r => ({ p: computeProbabilityFromComponents(r.components, v.weights), outcome: r.outcome }));
    return { ...v, liveBrier: brierScore(preds), liveN: liveRows.length };
  });
}

export function pickBestWeights(scoredVectors) {
  return scoredVectors.reduce((best, v) => (best == null || v.liveBrier < best.liveBrier) ? v : best, null);
}
