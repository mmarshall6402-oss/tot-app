// lib/backtest/score-curves.js
//
// Scores a set of calibration curves (past fits from model_calibration, or a
// brand-new candidate) against real live picks by Brier score — lower is
// better. Used so the system can pick the best-performing curve on its own
// instead of a human comparing dates in the admin history list.

import { brierScore, isotonicPredict } from "./metrics.js";

// curves: [{ id, controlPoints, ... }] — extra fields pass through untouched.
// liveRows: [{ modelProb, outcome }]
export function scoreCurvesOnLiveData(curves, liveRows) {
  return curves.map(c => {
    const preds = liveRows.map(r => ({ p: isotonicPredict(c.controlPoints, r.modelProb), outcome: r.outcome }));
    return { ...c, liveBrier: brierScore(preds), liveN: liveRows.length };
  });
}

// Lowest Brier wins; ties keep whichever came first in the input order.
export function pickBestCurve(scoredCurves) {
  return scoredCurves.reduce((best, c) => (best == null || c.liveBrier < best.liveBrier) ? c : best, null);
}
