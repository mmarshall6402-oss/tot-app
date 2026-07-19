#!/usr/bin/env node
// scripts/backtest/verify-filter-refactor.js
//
// Regression check for pure-refactor changes to lib/filter.js (e.g. the
// FILTER_PARAMS extraction). Runs Tier 3 (the only harness that exercises
// applyFilterLayer end-to-end) and deep-diffs every row and metric against
// a saved snapshot. Zero diff required.
//
// Usage:
//   node scripts/backtest/verify-filter-refactor.js --save   (write the baseline snapshot)
//   node scripts/backtest/verify-filter-refactor.js          (compare current output to the saved snapshot)

import { writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { runTier3 } from "../../lib/backtest/tier3-runner.js";

const SNAPSHOT_PATH = join(process.cwd(), "scripts/backtest/.filter-refactor-snapshot.json");
const save = process.argv.includes("--save");

const result = runTier3({ season: "2025" });
const serialized = JSON.stringify(result, null, 2);

if (save) {
  writeFileSync(SNAPSHOT_PATH, serialized + "\n");
  console.log(`Saved baseline snapshot (${result.gameCount} games) to ${SNAPSHOT_PATH}`);
  process.exit(0);
}

if (!existsSync(SNAPSHOT_PATH)) {
  console.error(`No baseline snapshot at ${SNAPSHOT_PATH} — run with --save first (before your refactor).`);
  process.exit(1);
}

const baseline = readFileSync(SNAPSHOT_PATH, "utf8").trim();
const current = serialized;

if (baseline === current) {
  console.log(`OK — Tier 3 output byte-identical to baseline (${result.gameCount} games).`);
  process.exit(0);
} else {
  console.error("MISMATCH — Tier 3 output differs from baseline snapshot. This refactor changed behavior.");
  process.exit(1);
}
