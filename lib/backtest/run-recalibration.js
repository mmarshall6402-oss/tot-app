// lib/backtest/run-recalibration.js
//
// Shared core used by both scripts/backtest/recalibrate.js (manual CLI,
// heavy historical replay via runTier2) and app/api/cron/recalibrate/route.js
// (daily cron, reads the cached historical-rows.json dump instead). Fits an
// isotonic curve blending historical replay data with live resolved
// model_picks rows, records it as a history row, and — when write=true —
// activates whichever curve (today's new fit, or a past one) actually
// scores best on live production data. Daily fitting means daily variance;
// this makes sure that variance can only ever activate an improvement, not
// silently ship a regression, without a human having to compare dates by hand.

import { fitCalibrationCurve } from "./calibration-fit.js";
import { brierScore, logLoss, isotonicPredict } from "./metrics.js";
import { scoreCurvesOnLiveData, pickBestCurve } from "./score-curves.js";
import {
  insertCalibrationCurve,
  activateCalibrationCurveById,
  listCalibrationCurvesWithPoints,
  setActiveCalibrationCurve,
} from "../calibration-db.js";

// historicalRows/liveRows: [{modelProb, outcome, season}]
export async function runRecalibration(supabase, {
  historicalRows,
  liveRows,
  write = false,
  minLiveForSelection = 20,
  source = "manual",
} = {}) {
  const diagnostic = {};

  // Genuine holdout: liveRows were never seen by a historical-only fit, so
  // this shows whether isotonic calibration still generalizes to real
  // production picks before we blend them into today's candidate.
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

  const notes = `${source}: ${historicalRows.length} historical + ${liveRows.length} live model_picks`;

  // Not enough live signal yet to trust a live-data comparison — just
  // publish today's fit outright, same as the old always-overwrite
  // behavior. This only matters early on, before enough picks have settled.
  if (liveRows.length < minLiveForSelection) {
    const saved = await setActiveCalibrationCurve(supabase, curve, "mlb", notes);
    result.written = true;
    result.calibrationId = saved.id;
    result.selection = "insufficient-live-data";
    return result;
  }

  // Record today's fit as a candidate, then let it compete on equal footing
  // against every past curve — the system picks whichever one actually
  // performs best on live picks, so nobody has to eyeball the history list.
  const inserted = await insertCalibrationCurve(supabase, curve, "mlb", notes);
  const history = await listCalibrationCurvesWithPoints(supabase, "mlb");
  const scored = scoreCurvesOnLiveData(history, liveRows);
  const best = pickBestCurve(scored);

  await activateCalibrationCurveById(supabase, best.id, "mlb");

  result.written = true;
  result.calibrationId = best.id;
  result.bestLiveBrier = best.liveBrier;
  result.selection = best.id === inserted.id ? "new-fit-is-best" : "kept-past-curve";
  return result;
}
