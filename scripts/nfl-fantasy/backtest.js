#!/usr/bin/env node
// scripts/nfl-fantasy/backtest.js
//
// Developer-run CLI for the fantasy rankings backtest. Follows this repo's
// existing "run manually, no orchestrator" convention (scripts/backtest/run.js).
// Reads the cached nflverse data written by fetch-nflverse.js and replays the
// real ranking pipeline against a season whose outcome is already known.
//
// Usage:
//   node --env-file=.env.local scripts/nfl-fantasy/backtest.js --season=2025 --format=ppr
//   npm run fantasy-backtest -- --season=2025 --format=ppr --dry-run
import { readFile } from "fs/promises";
import { join } from "path";
import { createClient } from "@supabase/supabase-js";
import { runFantasyBacktest } from "../../lib/nfl-fantasy/backtest-runner.js";
import { persistFantasyBacktestRun } from "../../lib/nfl-fantasy/persist-backtest.js";

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

// Prints a plain pass/fail summary against both baselines — the actual
// go/no-go gate before this data is trusted for a real draft, not just raw
// numbers to eyeball.
function summarize(metrics) {
  const positions = Object.keys(metrics.model);
  console.log("\nModel vs. baselines (precision@N by position):");
  let winsPlain = 0, winsNaive = 0, total = 0;
  for (const pos of positions) {
    const m = metrics.model[pos]?.precisionAtN;
    const plain = metrics.plainVorpBaseline[pos]?.precisionAtN;
    const naive = metrics.naiveLastSeasonBaseline[pos]?.precisionAtN;
    if (m == null) continue;
    total++;
    if (plain == null || m > plain) winsPlain++;
    if (naive == null || m > naive) winsNaive++;
    console.log(`  ${pos}: model=${m?.toFixed(2)} plainVorp=${plain?.toFixed(2) ?? "n/a"} naiveLastSeason=${naive?.toFixed(2) ?? "n/a"}`);
  }
  console.log(`\nBeats plain-VORP baseline on ${winsPlain}/${total} positions.`);
  console.log(`Beats naive-last-season baseline on ${winsNaive}/${total} positions.`);
  if (winsPlain < total || winsNaive < total) {
    console.log("\nDo NOT ship the cheat sheet UI until this beats both baselines on every position — tune the constants in lib/nfl-fantasy/project.js, replacement.js, vorp.js and re-run.");
  }
}

async function main() {
  const { season, format, dryRun, dataDir } = parseArgs(process.argv.slice(2));
  const playerStatsRows = JSON.parse(await readFile(join(dataDir, "player_stats.json"), "utf8"));

  console.log(`Running fantasy backtest for target season ${season} (${format}) against ${playerStatsRows.length} weekly stat rows from ${dataDir}...`);
  const result = runFantasyBacktest({ playerStatsRows, targetSeason: season, format });

  console.log(JSON.stringify(result.metrics, null, 2));
  summarize(result.metrics);

  if (dryRun) {
    console.log("\n--dry-run: skipping Supabase write.");
    return;
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
  const run = await persistFantasyBacktestRun(supabase, result);
  console.log(`\nSaved as nfl_fantasy_backtest_runs.id = ${run.id}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
