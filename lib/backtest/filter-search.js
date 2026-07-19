// lib/backtest/filter-search.js
//
// Evidence-gathering tools for retuning lib/filter.js's FILTER_PARAMS against
// an improved probability source. Mirrors lib/backtest/weight-search.js's
// mutate-in-place-and-restore pattern, but deliberately does NOT optimize
// against Tier 3 ROI/win% — real market odds exist for 2025 only, so there is
// no unseen holdout season the way weight-search.js has for WEIGHTS. Treat
// evaluateFilterCandidate() as a secondary sanity check on a small sample,
// and inBandCalibrationReport() (thousands of games, 2022-2025) as the
// primary evidence for deriving candidate parameter vectors by hand.

import { FILTER_PARAMS } from "../filter.js";
import { runTier3 } from "./tier3-runner.js";
import { calibrationBuckets, wilsonInterval } from "./metrics.js";
import { getModelProbability, getCalibratedModelProbability, setEloRatings, setCalibrationCurve } from "../probability.js";

// Runs Tier 3 (real 2025 odds, full filter + Kelly replay) with FILTER_PARAMS
// temporarily overridden by `paramOverrides`, then restores the originals —
// even if runTier3 throws, so shared module state never leaks a partial edit.
export function evaluateFilterCandidate(paramOverrides, { useCalibration = true, calibrationCurve = null, season = "2025" } = {}) {
  const baseline = { ...FILTER_PARAMS };
  try {
    Object.assign(FILTER_PARAMS, paramOverrides);
    const result = runTier3({ season, useCalibration, calibrationCurve });
    return withWilsonCI(result);
  } finally {
    Object.assign(FILTER_PARAMS, baseline);
  }
}

// Adds a Wilson 95% CI on win% to Tier 3's overall metrics and each verdict
// bucket — tier3-runner.js doesn't compute this itself, and every number
// from a ~5-30 bet sample needs one to be read honestly.
function withWilsonCI(result) {
  const { wins, betsPlaced } = result.metrics;
  const overallCI = wilsonInterval(wins, betsPlaced);
  const verdictBreakdown = result.metrics.verdictBreakdown.map(v => ({
    ...v,
    winCI: wilsonInterval(v.wins, v.settled),
  }));
  return {
    ...result,
    metrics: { ...result.metrics, winCI: overallCI, verdictBreakdown },
  };
}

// Fine-grained (default 1pp) calibration buckets over `filter.js`'s actual
// operating band [0.50, 0.66] — the blend/ceiling only ever act on
// sharpImpliedP..sharpImpliedP+6pp, and the dynamic-edge tiers key off
// 0.57/0.62 implied probability. Computed for both raw and calibrated
// probability so the delta shows how much in-band overconfidence
// calibration has actually closed, using thousands of games rather than a
// single season of bets — the primary evidence for Stage 3's candidates.
export function inBandCalibrationReport(rows, curve, { lo = 0.50, hi = 0.66, bucketWidth = 0.01 } = {}) {
  const buckets = [];
  for (let x = lo; x < hi - 1e-9; x += bucketWidth) {
    const bLo = x, bHi = x + bucketWidth;
    buckets.push({ label: `${Math.round(bLo * 100)}-${Math.round(bHi * 100)}%`, lo: bLo, hi: bHi, mid: (bLo + bHi) / 2 });
  }

  const rawPreds = rows.map(r => ({ p: r.modelProb, outcome: r.outcome }));
  setCalibrationCurve(curve);
  const calibratedPreds = rows.map(r => {
    setEloRatings({ [r.homeTeam]: r.preGameElo.home, [r.awayTeam]: r.preGameElo.away });
    return { p: getCalibratedModelProbability({ homeTeam: r.homeTeam, awayTeam: r.awayTeam }, r.mlb), outcome: r.outcome };
  });

  return {
    raw: calibrationBuckets(rawPreds, buckets),
    calibrated: calibrationBuckets(calibratedPreds, buckets),
  };
}

// Builds the { modelProb, outcome, season, homeTeam, awayTeam, mlb, preGameElo }
// rows inBandCalibrationReport() needs, reusing the exact walk-forward
// construction weight-search.js's buildEvalRows() already does, plus the raw
// modelProb and mlb feature object it doesn't currently expose.
export function buildInBandRows(evalRows) {
  return evalRows.map(r => {
    setEloRatings({ [r.homeTeam]: r.preGameElo.home, [r.awayTeam]: r.preGameElo.away });
    const modelProb = getModelProbability({ homeTeam: r.homeTeam, awayTeam: r.awayTeam }, r.mlb);
    return { ...r, modelProb };
  });
}
