// lib/backtest/historical-rows.js
//
// Loads the precomputed historical {modelProb, outcome, season} rows written
// by scripts/backtest/recalibrate.js (via runTier2's full walk-forward
// replay). Deployed routes read this static, tiny JSON dump instead of
// calling runTier2() directly — that replay pulls in lib/elo-db.js's
// season-stats machinery over the full data/retrosheet/** corpus (see the
// outputFileTracingExcludes note in next.config.mjs), which is far too heavy
// to redo on every cron invocation and would drag that corpus into the
// cron's serverless bundle.

import { readFileSync } from "fs";
import { join } from "path";

export function loadHistoricalCalibrationRows(path = "data/calibration/historical-rows.json") {
  try {
    return JSON.parse(readFileSync(join(process.cwd(), path), "utf8"));
  } catch {
    return [];
  }
}
