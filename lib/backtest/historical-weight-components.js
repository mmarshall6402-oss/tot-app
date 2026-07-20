// lib/backtest/historical-weight-components.js
//
// Loads the precomputed historical {components, outcome, season} rows
// written by scripts/backtest/tune-weights-live.js (via a walk-forward
// replay identical to weight-search.js's buildEvalRows, but storing
// getModelProbabilityComponents() output per game instead of a single
// probability). Same reasoning as lib/backtest/historical-rows.js: the
// replay itself depends on the full data/retrosheet/** corpus, which
// next.config.mjs deliberately keeps out of every deployed route except the
// backtest admin one — a live cron reads this small cached dump instead.

import { readFileSync } from "fs";
import { join } from "path";

export function loadHistoricalWeightComponents(path = "data/calibration/historical-weight-components.json") {
  try {
    return JSON.parse(readFileSync(join(process.cwd(), path), "utf8"));
  } catch {
    return [];
  }
}
