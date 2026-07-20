#!/usr/bin/env node
// scripts/backtest/recalibrate.js
//
// Refits the isotonic calibration curve using resolved model_picks rows —
// the same production prediction-vs-outcome data behind the calibration
// dashboard (app/api/calibration/route.js) and the per-game recap endpoint
// (app/api/tracker/game-recap/route.js pulls its `result` from the same
// resolved picks) — blended with the offline historical replay. Unlike the
// old fit-calibration-seed.js, this writes the result as the new ACTIVE
// production curve (lib/calibration-db.js), so real prediction errors
// actually feed back into the live model.
//
// Also refreshes data/calibration/historical-rows.json — a cached dump of
// the historical replay rows that app/api/cron/recalibrate/route.js (the
// automated daily version of this script) reads instead of redoing the full
// walk-forward replay on every cron tick. Run this after data/games.json
// changes (new season data, retrosheet updates) to keep that cache current.
//
// Usage:
//   node --env-file=.env.local scripts/backtest/recalibrate.js
//   node --env-file=.env.local scripts/backtest/recalibrate.js --write   (publishes as the new active curve)

import { writeFileSync } from "fs";
import { join } from "path";
import { createClient } from "@supabase/supabase-js";
import { runTier2 } from "../../lib/backtest/tier2-runner.js";
import { fetchLiveCalibrationRows } from "../../lib/backtest/live-picks.js";
import { runRecalibration } from "../../lib/backtest/run-recalibration.js";

const write = process.argv.includes("--write");

async function main() {
  const historicalRows = runTier2({}).rows.map(r => ({
    modelProb: r.model_home_prob,
    outcome: r.home_won ? 1 : 0,
    season: r.date.slice(0, 4),
  }));

  const cachePath = join(process.cwd(), "data/calibration/historical-rows.json");
  writeFileSync(cachePath, JSON.stringify(historicalRows) + "\n");
  console.log(`Refreshed ${cachePath} (${historicalRows.length} historical rows).`);

  let liveRows = [];
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    liveRows = await fetchLiveCalibrationRows(supabase);

    if (!liveRows.length) {
      console.warn("No resolved picks found in model_picks — recalibrating from historical data only.");
    }

    const result = await runRecalibration(supabase, { historicalRows, liveRows, write, source: "cli" });

    if (liveRows.length) {
      console.log(`\nLive production picks (held out of the historical-only fit): ${liveRows.length}`);
      console.log(`  Brier   raw=${result.diagnostic.liveBrierRaw.toFixed(4)}  historical-curve-applied=${result.diagnostic.liveBrierHistoricalCurve.toFixed(4)}`);
      console.log(`  LogLoss raw=${result.diagnostic.liveLogLossRaw.toFixed(4)}  historical-curve-applied=${result.diagnostic.liveLogLossHistoricalCurve.toFixed(4)}`);
    }

    console.log(`\nFit curve on ${result.curve.gameCount} games (${result.historicalCount} historical + ${result.liveCount} live), seasons ${result.curve.trainSeasons.join(", ")}`);

    if (!write) {
      console.log("\n--write not passed: not persisted to Supabase.");
    } else if (result.selection === "new-fit-is-best") {
      console.log(`\nToday's fit is the best-scoring curve on live data (Brier=${result.bestLiveBrier.toFixed(4)}) — activated as id=${result.calibrationId}.`);
    } else if (result.selection === "kept-past-curve") {
      console.log(`\nA past curve still outscores today's fit on live data (Brier=${result.bestLiveBrier.toFixed(4)}) — kept id=${result.calibrationId} active instead.`);
    } else if (result.written) {
      console.log(`\nWrote model_calibration row id=${result.calibrationId} (now active — not enough live data yet to compare curves).`);
    }
  } catch (err) {
    console.error("\nLive recalibration step failed (historical-rows.json cache was still refreshed above):", err.message);
    if (write) process.exitCode = 1;
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
