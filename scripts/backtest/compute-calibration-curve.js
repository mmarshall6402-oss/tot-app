#!/usr/bin/env node
// scripts/backtest/compute-calibration-curve.js
//
// Reliability-diagram data for the Streamlit dashboard's calibration tab:
// raw model probability vs. actual outcome, and the same rows run through
// the production isotonic curve. Reuses lib/backtest/metrics.js's exact
// bucketing/Brier/isotonic-predict logic (the same functions the live app
// and backtest harness use) so the dashboard never risks drifting from a
// reimplementation. No Supabase, no live model changes.
//
// Usage:
//   node scripts/backtest/compute-calibration-curve.js
//   npm run calibration-curve

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { calibrationBuckets, defaultBuckets, isotonicPredict, brierScore, logLoss } from "../../lib/backtest/metrics.js";

const ROOT = process.cwd();

function main() {
  const rows = JSON.parse(readFileSync(join(ROOT, "data/calibration/historical-rows.json"), "utf8"));
  const curve = JSON.parse(readFileSync(join(ROOT, "data/calibration/mlb_isotonic_v1.json"), "utf8"));

  const rawPreds = rows.map(r => ({ p: r.modelProb, outcome: r.outcome }));
  const calibratedPreds = rows.map(r => ({ p: isotonicPredict(curve.controlPoints, r.modelProb), outcome: r.outcome }));

  // The isotonic curve was fit on trainSeasons only — evaluating it against
  // those same rows overstates the fit (in-sample). Report both the full
  // history and the genuinely out-of-sample holdout (seasons not used in
  // training) so the dashboard can be honest about which is which.
  const trainSeasons = new Set((curve.trainSeasons || []).map(String));
  const holdoutIdx = rows.map((r, i) => (trainSeasons.has(String(r.season)) ? -1 : i)).filter(i => i >= 0);
  const rawHoldout = holdoutIdx.map(i => rawPreds[i]);
  const calibratedHoldout = holdoutIdx.map(i => calibratedPreds[i]);

  // calibrationBuckets()'s "predicted" field is the fixed bin midpoint
  // (see lib/backtest/metrics.js) — a deliberate simplification for a
  // stable x-position, shared with the production admin calibration chart.
  // For this dashboard we also want the TRUE mean predicted probability
  // within each bin, which genuinely scatters instead of landing on the
  // midpoint every time. Computed here (not in metrics.js) so the shared
  // production function stays untouched; reuses the exact same bucket
  // boundaries via defaultBuckets() so there's no risk of the two disagreeing
  // on where a bin starts/ends.
  const buckets = defaultBuckets();
  const summarize = preds => ({
    buckets: calibrationBuckets(preds, buckets).map((b, i) => {
      const { lo, hi } = buckets[i];
      const slice = preds.filter(({ p }) => p >= lo && p < hi);
      const meanPredicted = slice.length ? slice.reduce((s, { p }) => s + p, 0) / slice.length : null;
      return { ...b, meanPredicted };
    }),
    brier: brierScore(preds),
    logLoss: logLoss(preds),
    n: preds.length,
  });

  const result = {
    trainSeasons: curve.trainSeasons,
    trainGameCount: curve.gameCount,
    fittedAt: curve.fittedAt,
    all: {
      raw: summarize(rawPreds),
      calibrated: summarize(calibratedPreds),
    },
    holdout: holdoutIdx.length
      ? {
          raw: summarize(rawHoldout),
          calibrated: summarize(calibratedHoldout),
        }
      : null,
  };

  const outPath = join(ROOT, "data/calibration_curve.json");
  writeFileSync(outPath, JSON.stringify(result, null, 2) + "\n");
  console.log(
    `Wrote ${outPath} — all N=${result.all.raw.n} (Brier ${result.all.raw.brier.toFixed(4)} -> ${result.all.calibrated.brier.toFixed(4)})` +
      (result.holdout ? `, holdout N=${result.holdout.raw.n} (Brier ${result.holdout.raw.brier.toFixed(4)} -> ${result.holdout.calibrated.brier.toFixed(4)})` : "")
  );
}

main();
