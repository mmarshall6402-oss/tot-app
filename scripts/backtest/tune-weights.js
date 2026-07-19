#!/usr/bin/env node
// scripts/backtest/tune-weights.js
//
// Runs lib/backtest/weight-search.js's coordinate-ascent search over
// probability.js's top-level factor-scale constants and prints the
// before/after evidence. Read-only / report-only — does not edit
// lib/probability.js. A human reviews the printed evidence and decides
// whether to apply the recommended vector.

import { buildEvalRows, searchWeights, evaluateHoldout } from "../../lib/backtest/weight-search.js";
import { WEIGHTS } from "../../lib/probability.js";

const rows = buildEvalRows();

function grid(center, factors) {
  return [...new Set([center, ...factors.map(f => Math.round(center * f * 1e6) / 1e6)])];
}

const paramSpecs = [
  { name: "PITCHER_DIFF_SCALE", candidates: grid(WEIGHTS.PITCHER_DIFF_SCALE, [0.6, 0.8, 1.0, 1.2, 1.4]) },
  { name: "LINEUP_DIFF_SCALE", candidates: grid(WEIGHTS.LINEUP_DIFF_SCALE, [0.6, 0.8, 1.0, 1.2, 1.4]) },
  { name: "BULLPEN_DIFF_SCALE", candidates: grid(WEIGHTS.BULLPEN_DIFF_SCALE, [0.6, 0.8, 1.0, 1.2, 1.4]) },
  { name: "ELO_DIFF_SCALE", candidates: grid(WEIGHTS.ELO_DIFF_SCALE, [0.6, 0.8, 1.0, 1.2, 1.4]) },
  { name: "FORM_DIFF_SCALE", candidates: grid(WEIGHTS.FORM_DIFF_SCALE, [0.4, 0.7, 1.0, 1.5, 2.0]) },
  { name: "HR_FACTOR_SCALE", candidates: grid(WEIGHTS.HR_FACTOR_SCALE, [0.4, 0.7, 1.0, 1.5, 2.0]) },
];

console.log(`Loaded ${rows.length} historical games.`);
console.log("Searching over:", paramSpecs.map(p => p.name).join(", "));

const result = searchWeights({ rows, trainSeasons: ["2022", "2023", "2024"], paramSpecs, passes: 2 });

console.log("\n=== Per-season Brier: baseline vs recommended (2022-2024, search set) ===");
for (const s of ["2022", "2023", "2024"]) {
  console.log(`  ${s}: ${result.baselineBySeasson[s].toFixed(4)} -> ${result.recommendedBySeasson[s].toFixed(4)}`);
}

console.log(`\n=== Accepted changes (${result.changes.length}) ===`);
if (!result.changes.length) {
  console.log("  None — no coordinate step improved (or tied) Brier on all three training seasons.");
} else {
  for (const c of result.changes) {
    console.log(`  pass ${c.pass}: ${c.param}  ${c.from} -> ${c.to}`);
  }
}

console.log("\n=== Confirmatory 2025 holdout (never used during search) ===");
const before = evaluateHoldout(rows, result.baseline, "2025");
const after = evaluateHoldout(rows, result.recommended, "2025");
console.log(`  baseline:    Brier=${before.brier.toFixed(4)}  LogLoss=${before.logLoss.toFixed(4)}  (n=${before.n})`);
console.log(`  recommended: Brier=${after.brier.toFixed(4)}  LogLoss=${after.logLoss.toFixed(4)}  (n=${after.n})`);

console.log("\nRecommended vector (NOT applied to lib/probability.js):");
console.log(JSON.stringify(result.recommended, null, 2));
