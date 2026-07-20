// lib/backtest/run-recalibration.js
//
// Shared core used by both scripts/backtest/recalibrate.js (manual CLI,
// heavy historical replay via runTier2) and app/api/cron/recalibrate/route.js
// (daily cron, reads the cached historical-rows.json dump instead). Fits an
// isotonic curve blending historical replay data with live resolved
// model_picks rows, and — when write=true — publishes it as the new active
// model_calibration row, guarded so a broken fit can't silently ship a
// worse curve than what's already live.

import { fitCalibrationCurve } from "./calibration-fit.js";
import { brierScore, logLoss, isotonicPredict } from "./metrics.js";
import { getCalibrationCurve, setActiveCalibrationCurve } from "../calibration-db.js";

// historicalRows/liveRows: [{modelProb, outcome, season}]
export async function runRecalibration(supabase, {
  historicalRows,
  liveRows,
  write = false,
  minLiveForGuard = 20,
  maxBrierRegression = 0.01,
  source = "manual",
} = {}) {
  const diagnostic = {};

  // Genuine holdout: liveRows were never seen by a historical-only fit, so
  // this shows whether isotonic calibration still generalizes to real
  // production picks before we blend them into the curve that ships.
  if (liveRows.length) {
    const historicalOnlyCurve = fitCalibrationCurve(historicalRows);
    const before = liveRows.map(r => ({ p: r.modelProb, outcome: r.outcome }));
    const after  = liveRows.map(r => ({ p: isotonicPredict(historicalOnlyCurve.controlPoints, r.modelProb), outcome: r.outcome }));
    diagnostic.liveBrierRaw = brierScore(before);
    diagnostic.liveBrierHistoricalCurve = brierScore(after);
    diagnostic.liveLogLossRaw = logLoss(before);
    diagnostic.liveLogLossHistoricalCurve = logLoss(after);
  }

  const curve = fitCalibrationCurve([...historicalRows, ...liveRows]);

  const result = {
    curve,
    diagnostic,
    historicalCount: historicalRows.length,
    liveCount: liveRows.length,
    written: false,
  };

  if (!write) return result;

  // Don't ship a curve that performs worse than what's already active on
  // real production picks — a regression here means the fit is broken, not
  // that recalibration "worked". Skipped below this sample size: too little
  // live signal to trust the comparison either way.
  if (liveRows.length >= minLiveForGuard) {
    const active = await getCalibrationCurve(supabase);
    if (active?.controlPoints?.length) {
      const preds = cp => liveRows.map(r => ({ p: isotonicPredict(cp, r.modelProb), outcome: r.outcome }));
      const currentBrier = brierScore(preds(active.controlPoints));
      const newBrier = brierScore(preds(curve.controlPoints));
      result.currentActiveBrier = currentBrier;
      result.newCurveBrier = newBrier;
      if (newBrier > currentBrier + maxBrierRegression) {
        result.skippedReason = `new curve Brier (${newBrier.toFixed(4)}) worse than active (${currentBrier.toFixed(4)}) on ${liveRows.length} live picks`;
        return result;
      }
    }
  }

  const saved = await setActiveCalibrationCurve(
    supabase, curve, "mlb",
    `${source}: ${historicalRows.length} historical + ${liveRows.length} live model_picks`
  );
  result.written = true;
  result.calibrationId = saved.id;
  return result;
}
