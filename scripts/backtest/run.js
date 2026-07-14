#!/usr/bin/env node
// scripts/backtest/run.js
//
// Developer-run CLI entry point for the backtesting engine. Follows this
// repo's existing "run manually, no orchestrator" convention (see the
// sql/*.sql migration file headers). Replays historical MLB games through
// the real production model/filter code and writes results to Supabase.
//
// Usage:
//   node --env-file=.env.local scripts/backtest/run.js --tier=1 --seasons=2022,2023,2024
//   npm run backtest -- --tier=1 --seasons=2022,2023,2024

import { createClient } from "@supabase/supabase-js";
import { runTier1 } from "../../lib/backtest/tier1-runner.js";
import { runTier2 } from "../../lib/backtest/tier2-runner.js";
import { runTier3 } from "../../lib/backtest/tier3-runner.js";
import { persistRun } from "../../lib/backtest/persist.js";

function parseArgs(argv) {
  const args = { tier: 1, seasons: null, dryRun: false };
  for (const arg of argv) {
    if (arg === "--dry-run") { args.dryRun = true; continue; }
    const [key, value] = arg.replace(/^--/, "").split("=");
    if (key === "tier") args.tier = parseInt(value, 10);
    if (key === "seasons") args.seasons = value.split(",").map(s => parseInt(s.trim(), 10));
  }
  return args;
}

async function main() {
  const { tier, seasons, dryRun } = parseArgs(process.argv.slice(2));

  console.log(`Running Tier ${tier} backtest${seasons ? ` for seasons ${seasons.join(",")}` : " (all seasons)"}...`);

  let result;
  if (tier === 1) {
    result = runTier1({ seasons });
  } else if (tier === 2) {
    result = runTier2({ seasons });
  } else if (tier === 3) {
    result = runTier3({ season: seasons?.[0] ? String(seasons[0]) : "2025" });
  } else {
    console.error(`Tier ${tier} is not implemented yet.`);
    process.exit(1);
  }

  console.log(`Computed metrics for ${result.gameCount} games (${result.seasonStart} -> ${result.seasonEnd}).`);
  console.log(JSON.stringify(result.metrics, null, 2));

  if (dryRun) {
    console.log("\n--dry-run: skipping Supabase write.");
    return;
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
  const run = await persistRun(supabase, result);
  console.log(`\nSaved as backtest_runs.id = ${run.id}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
