#!/usr/bin/env node
// scripts/backtest/recalibrate.js
//
// Refits the isotonic calibration curve using resolved model_picks rows —
// the same production prediction-vs-outcome data behind the calibration
// dashboard (app/api/calibration/route.js) and the per-game recap endpoint
// (app/api/tracker/game-recap/route.js pulls its `result` from the same
// resolved picks) — blended with the offline historical replay that
// fit-calibration-seed.js uses. Unlike that script, this one writes the
// result as the new ACTIVE production curve (lib/calibration-db.js), so
// real prediction errors actually feed back into the live model.
//
// Diagnostic: before writing, checks how a curve fit on historical data
// ALONE performs on live picks it never saw — a genuine holdout, since
// live picks are this season's real bets. The curve that actually gets
// written trains on historical + live combined.
//
// Usage:
//   node --env-file=.env.local scripts/backtest/recalibrate.js
//   node --env-file=.env.local scripts/backtest/recalibrate.js --write   (writes the new active model_calibration row)

import { createClient } from "@supabase/supabase-js";
import { runTier2 } from "../../lib/backtest/tier2-runner.js";
import { fetchLiveCalibrationRows } from "../../lib/backtest/live-picks.js";
import { fitCalibrationCurve } from "../../lib/backtest/calibration-fit.js";
import { setActiveCalibrationCurve } from "../../lib/calibration-db.js";
import { brierScore, logLoss, isotonicPredict } from "../../lib/backtest/metrics.js";

const write = process.argv.includes("--write");

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const historicalRows = runTier2({}).rows.map(r => ({
    modelProb: r.model_home_prob,
    outcome: r.home_won ? 1 : 0,
    season: r.date.slice(0, 4),
  }));
  const liveRows = await fetchLiveCalibrationRows(supabase);

  if (!liveRows.length) {
    console.warn("No resolved picks found in model_picks — recalibrating from historical data only.");
  } else {
    const historicalOnlyCurve = fitCalibrationCurve(historicalRows);
    const before = liveRows.map(r => ({ p: r.modelProb, outcome: r.outcome }));
    const after  = liveRows.map(r => ({ p: isotonicPredict(historicalOnlyCurve.controlPoints, r.modelProb), outcome: r.outcome }));
    console.log(`Live production picks (held out of this fit): ${liveRows.length}`);
    console.log(`  Brier   raw=${brierScore(before).toFixed(4)}  historical-curve-applied=${brierScore(after).toFixed(4)}`);
    console.log(`  LogLoss raw=${logLoss(before).toFixed(4)}  historical-curve-applied=${logLoss(after).toFixed(4)}`);
  }

  const curve = fitCalibrationCurve([...historicalRows, ...liveRows]);
  console.log(`\nFit curve on ${curve.gameCount} games (${historicalRows.length} historical + ${liveRows.length} live), seasons ${curve.trainSeasons.join(", ")}`);

  if (write) {
    const saved = await setActiveCalibrationCurve(
      supabase, curve, "mlb",
      `${historicalRows.length} historical + ${liveRows.length} live model_picks`
    );
    console.log(`\nWrote model_calibration row id=${saved.id} (now active).`);
  } else {
    console.log("\n--write not passed: not persisted to Supabase.");
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
