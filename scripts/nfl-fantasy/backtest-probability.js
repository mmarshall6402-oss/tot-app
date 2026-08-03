#!/usr/bin/env node
// scripts/nfl-fantasy/backtest-probability.js
//
// Developer-run CLI that seeds fantasy_probability_log (sql/018) with
// historical Start/Sit calibration data, so the public calibration page
// (app/calibration/page.js) has real numbers before a single live user has
// run the tool. Follows this repo's existing "run manually, no
// orchestrator" convention (scripts/backtest/run.js, scripts/nfl-fantasy/backtest.js).
//
// Usage:
//   node --env-file=.env.local scripts/nfl-fantasy/backtest-probability.js --season=2025 --format=ppr
//   npm run fantasy-probability-backtest -- --season=2025 --format=ppr --dry-run
//
// Run once per target season you want seeded (earliest usable is the second
// season in data/nflverse/player_stats.json, since buildPlayerProjection
// needs at least one prior season of history).
import { readFile } from "fs/promises";
import { join } from "path";
import { createClient } from "@supabase/supabase-js";
import { runProbabilityBacktest } from "../../lib/nfl-fantasy/probability-backtest.js";
import { persistProbabilityBacktestRows } from "../../lib/nfl-fantasy/probability-log.js";

function parseArgs(argv) {
  const args = { season: 2025, format: "ppr", dryRun: false, dataDir: join(process.cwd(), "data/nflverse") };
  for (const arg of argv) {
    if (arg === "--dry-run") { args.dryRun = true; continue; }
    const [key, value] = arg.replace(/^--/, "").split("=");
    if (key === "season") args.season = parseInt(value, 10);
    if (key === "format") args.format = value;
    if (key === "data-dir") args.dataDir = value;
  }
  return args;
}

function summarize(predictions) {
  const decided = predictions.filter((p) => p.actualWinner !== "push");
  const buckets = [
    { label: "50-60%", lo: 50, hi: 60 },
    { label: "60-70%", lo: 60, hi: 70 },
    { label: "70-80%", lo: 70, hi: 80 },
    { label: "80-90%", lo: 80, hi: 90 },
    { label: "90%+", lo: 90, hi: 101 },
  ];
  console.log("\nFavorite-probability calibration (quick summary, final buckets computed live by /api/nfl/fantasy/calibration):");
  for (const { label, lo, hi } of buckets) {
    const slice = decided.filter((p) => {
      const favProb = p.predictedProbA >= 50 ? p.predictedProbA : 100 - p.predictedProbA;
      return favProb >= lo && favProb < hi;
    });
    if (!slice.length) { console.log(`  ${label}: no samples`); continue; }
    const wins = slice.filter((p) => (p.predictedProbA >= 50 && p.actualWinner === "A") || (p.predictedProbA < 50 && p.actualWinner === "B")).length;
    console.log(`  ${label}: predicted favorite won ${(wins / slice.length * 100).toFixed(1)}% of ${slice.length} calls`);
  }
}

async function main() {
  const { season, format, dryRun, dataDir } = parseArgs(process.argv.slice(2));
  const playerStatsRows = JSON.parse(await readFile(join(dataDir, "player_stats.json"), "utf8"));
  const playersRows = JSON.parse(await readFile(join(dataDir, "players.json"), "utf8").catch(() => "[]"));

  console.log(`Running Start/Sit probability backtest for target season ${season} (${format})...`);
  const { predictions } = runProbabilityBacktest({ playerStatsRows, playersRows, targetSeason: season, format });
  console.log(`Generated ${predictions.length} graded head-to-head calls across weeks 1-17.`);
  summarize(predictions);

  if (dryRun) {
    console.log("\n--dry-run: skipping Supabase write.");
    return;
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
  const inserted = await persistProbabilityBacktestRows(supabase, predictions, { format });
  console.log(`\nInserted ${inserted} rows into fantasy_probability_log for season ${season}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
