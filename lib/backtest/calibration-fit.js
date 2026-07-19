// lib/backtest/calibration-fit.js
//
// Reusable isotonic-calibration fitting, extracted from tier2-runner.js so
// the exact same logic can be (a) validated in the backtest harness and
// (b) run standalone to produce the control-point curve that ships to
// production via lib/calibration-db.js. Wraps metrics.js's PAVA fit — no
// new statistical code.

import { isotonicFit } from "./metrics.js";

// rows: [{ modelProb, outcome, season }] — the shape tier2-runner already
// produces internally. trainSeasons restricts the fit to specific season
// strings (e.g. ["2022", "2023", "2024"]); omit to use every row passed in.
export function fitCalibrationCurve(rows, { trainSeasons } = {}) {
  const trainRows = trainSeasons?.length
    ? rows.filter(r => trainSeasons.includes(String(r.season)))
    : rows;

  const controlPoints = isotonicFit(trainRows.map(r => ({ x: r.modelProb, y: r.outcome })));

  return {
    controlPoints,
    trainSeasons: trainSeasons ?? [...new Set(trainRows.map(r => String(r.season)))].sort(),
    gameCount: trainRows.length,
    fittedAt: new Date().toISOString(),
  };
}
