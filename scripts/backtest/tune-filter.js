#!/usr/bin/env node
// scripts/backtest/tune-filter.js
//
// Decision-gate report for retuning lib/filter.js's FILTER_PARAMS against the
// isotonic-calibrated probability model. Read-only / report-only — does not
// edit lib/filter.js. A human reviews this and decides whether to apply a
// candidate, request another iteration, or reject.
//
// Evidence order, per the model-improvement plan:
//   1. Tier 2-style in-band calibration delta (thousands of games) — PRIMARY.
//   2. filter.js's own predicted-vs-actual shift on 2025 rows — secondary.
//   3. Per-candidate Tier 3 before/after on real 2025 odds, with Wilson CIs.
//   4. Explicit statement: nothing here touches a live call site.
//   5. A recommendation.

import { readFileSync } from "fs";
import { join } from "path";
import { buildEvalRows } from "../../lib/backtest/weight-search.js";
import { buildInBandRows, inBandCalibrationReport, evaluateFilterCandidate } from "../../lib/backtest/filter-search.js";
import { FILTER_PARAMS } from "../../lib/filter.js";

const curve = JSON.parse(readFileSync(join(process.cwd(), "data/calibration/mlb_isotonic_v1.json"), "utf8"));

console.log("=".repeat(78));
console.log("STAGE 2a/3 — In-band calibration evidence (PRIMARY, thousands of games)");
console.log("=".repeat(78));

const evalRows = buildEvalRows();
const inBandRows = buildInBandRows(evalRows);
const { raw, calibrated } = inBandCalibrationReport(inBandRows, curve);

function weightedAbsGap(buckets) {
  let num = 0, den = 0;
  for (const b of buckets) {
    if (!b.n) continue;
    num += Math.abs(b.predicted - b.actual) * b.n;
    den += b.n;
  }
  return den > 0 ? num / den : 0;
}

console.log("\nbucket        raw: pred/actual/n        calibrated: pred/actual/n");
for (let i = 0; i < raw.length; i++) {
  const r = raw[i], c = calibrated[i];
  const fmt = b => `${(b.predicted * 100).toFixed(0)}%/${b.actual != null ? (b.actual * 100).toFixed(0) + "%" : "  -"}/n=${b.n}`;
  console.log(`  ${r.label.padEnd(10)} ${fmt(r).padEnd(24)} ${fmt(c)}`);
}

const rawGap = weightedAbsGap(raw);
const calibratedGap = weightedAbsGap(calibrated);
const restoreFraction = rawGap > 0 ? Math.max(0, Math.min(1, 1 - calibratedGap / rawGap)) : 0;

console.log(`\nWeighted avg |predicted - actual| in [50%,66%] band:`);
console.log(`  raw model:        ${(rawGap * 100).toFixed(2)}pp`);
console.log(`  calibrated model: ${(calibratedGap * 100).toFixed(2)}pp`);
console.log(`  => calibration closes ~${(restoreFraction * 100).toFixed(0)}% of the in-band overconfidence gap.`);

console.log("\n" + "=".repeat(78));
console.log("STAGE 3 — Derived candidate FILTER_PARAMS vectors");
console.log("=".repeat(78));
console.log(`
Derivation: commit 5aad788 cut the blend/edge-floor constants by a ~1.9x
factor (blend 0.38/0.22/0.12 -> 0.20/0.12/0.06; MIN_TRUE_EDGE 3.0% -> 1.5%;
dynamic floors likewise) to correct a measured -30.9pp overconfidence. If
calibration has already closed ${(restoreFraction * 100).toFixed(0)}% of that overconfidence in filter.js's
actual operating band, only proportionally less correction is still
warranted -- so each candidate restores ${(restoreFraction * 100).toFixed(0)}% of the distance back toward the
pre-5aad788 values (never fully reverting).
`);

const RATIO = 1.9; // avg of 0.38/0.20, 0.22/0.12, 0.12/0.06, MIN_TRUE_EDGE 0.030/0.015
function restored(current, ratio = RATIO, frac = restoreFraction) {
  return current * (1 + (ratio - 1) * frac);
}

const conservative = {
  BLEND_LOW: restored(FILTER_PARAMS.BLEND_LOW),
  BLEND_MED: restored(FILTER_PARAMS.BLEND_MED),
  BLEND_HIGH: restored(FILTER_PARAMS.BLEND_HIGH),
  // EDGE_CEILING_PP has no clean pre-5aad788 reference (it was introduced
  // fresh, replacing no ceiling at all) -- this increment is a bounded
  // judgment call, not ratio-derived like the others above.
  EDGE_CEILING_PP: FILTER_PARAMS.EDGE_CEILING_PP + 0.04 * restoreFraction,
};

const moderate = {
  ...conservative,
  MIN_TRUE_EDGE: restored(FILTER_PARAMS.MIN_TRUE_EDGE),
  DYN_EDGE_TIER1_FLOOR: restored(FILTER_PARAMS.DYN_EDGE_TIER1_FLOOR),
  DYN_EDGE_TIER2_FLOOR: restored(FILTER_PARAMS.DYN_EDGE_TIER2_FLOOR),
};

console.log("Conservative candidate (blend + ceiling only):");
console.log(" ", JSON.stringify(conservative, (k, v) => typeof v === "number" ? Math.round(v * 10000) / 10000 : v));
console.log("Moderate candidate (+ MIN_TRUE_EDGE + dynamic floors):");
console.log(" ", JSON.stringify(moderate, (k, v) => typeof v === "number" ? Math.round(v * 10000) / 10000 : v));

console.log("\n" + "=".repeat(78));
console.log("STAGE 4 — Tier 3 sanity check on real 2025 odds (SECONDARY, small sample)");
console.log("=".repeat(78));
console.log("Every number below is from a tiny sample (n<=30) -- treat as a sanity check, not proof.\n");

function printResult(label, result) {
  const { betsPlaced, wins, winPct, roiPct, winCI } = result.metrics;
  const ci = winCI.lo != null ? `[${(winCI.lo * 100).toFixed(0)}%, ${(winCI.hi * 100).toFixed(0)}%]` : "n/a";
  console.log(`${label}`);
  console.log(`  bets=${betsPlaced}  win%=${winPct?.toFixed(1) ?? "n/a"}  95% CI=${ci}  ROI=${roiPct?.toFixed(1) ?? "n/a"}%`);
}

const baseline = evaluateFilterCandidate({}, { useCalibration: false });
printResult("Current production (raw prob, current FILTER_PARAMS):", baseline);

const calibratedUnmodified = evaluateFilterCandidate({}, { useCalibration: true, calibrationCurve: curve });
printResult("\nCalibrated prob, UNMODIFIED FILTER_PARAMS (the collapse):", calibratedUnmodified);

const conservativeResult = evaluateFilterCandidate(conservative, { useCalibration: true, calibrationCurve: curve });
printResult("\nCalibrated prob, CONSERVATIVE candidate:", conservativeResult);

const moderateResult = evaluateFilterCandidate(moderate, { useCalibration: true, calibrationCurve: curve });
printResult("\nCalibrated prob, MODERATE candidate:", moderateResult);

console.log("\n" + "=".repeat(78));
console.log("STAGE 5 — Decision gate");
console.log("=".repeat(78));
console.log(`
No live call site (app/api/picks/route.js, app/api/cron/picks/route.js,
app/api/steals/route.js) is touched by this script or by anything it
produces. FILTER_PARAMS in lib/filter.js is unmodified on disk -- the
candidates above exist only in this report for review.

Read the numbers above with the small-sample caveat in mind: a handful of
bets cannot statistically prove a threshold change is correct. The
in-band calibration evidence (Stage 2a/3, thousands of games) is the
trustworthy signal; Tier 3 here is a sanity check for "did volume recover
toward baseline without an obviously broken win rate," not a fitting target.
`);
