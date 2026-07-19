#!/usr/bin/env node
// scripts/backtest/fit-calibration-seed.js
//
// Fits the isotonic calibration curve used to seed data/calibration/mlb_isotonic_v1.json
// (the static fallback lib/calibration-db.js reads before any live Supabase
// row exists — same role data/elo_ratings.json plays for lib/elo-db.js).
//
// Trains on every fully-completed season in data/games.json except the most
// recent one, which is held out purely to sanity-check the fit before it
// ships (not because the held-out season is excluded from the shipped curve's
// coverage — isotonic control points still apply to any input probability).
//
// Usage:
//   node scripts/backtest/fit-calibration-seed.js
//   node scripts/backtest/fit-calibration-seed.js --write   (writes the seed file; default is dry-run/print-only)

import { writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { runTier2 } from "../../lib/backtest/tier2-runner.js";
import { fitCalibrationCurve } from "../../lib/backtest/calibration-fit.js";
import { brierScore, logLoss, isotonicPredict } from "../../lib/backtest/metrics.js";

const write = process.argv.includes("--write");

const result = runTier2({});
const rows = result.rows.map(r => ({
  modelProb: r.model_home_prob,
  outcome: r.home_won ? 1 : 0,
  season: r.date.slice(0, 4),
}));

const seasons = [...new Set(rows.map(r => r.season))].sort();
const trainSeasons = seasons.slice(0, -1); // all but the most recent
const holdoutSeason = seasons[seasons.length - 1];

const curve = fitCalibrationCurve(rows, { trainSeasons });

const holdoutRows = rows.filter(r => r.season === holdoutSeason);
const before = holdoutRows.map(r => ({ p: r.modelProb, outcome: r.outcome }));
const after = holdoutRows.map(r => ({ p: isotonicPredict(curve.controlPoints, r.modelProb), outcome: r.outcome }));

console.log(`Trained on seasons: ${trainSeasons.join(", ")} (${curve.gameCount} games)`);
console.log(`Holdout sanity check — season ${holdoutSeason} (${holdoutRows.length} games):`);
console.log(`  Brier   before=${brierScore(before).toFixed(4)}  after=${brierScore(after).toFixed(4)}`);
console.log(`  LogLoss before=${logLoss(before).toFixed(4)}  after=${logLoss(after).toFixed(4)}`);

if (write) {
  const outPath = join(process.cwd(), "data/calibration/mlb_isotonic_v1.json");
  writeFileSync(outPath, JSON.stringify(curve, null, 2) + "\n");
  console.log(`\nWrote ${outPath}`);
} else {
  console.log("\n--write not passed: seed file not written.");
}
