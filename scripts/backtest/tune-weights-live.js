#!/usr/bin/env node
// scripts/backtest/tune-weights-live.js
//
// Live-data-aware counterpart to scripts/backtest/tune-weights.js. That
// script searches WEIGHTS purely against historical replay and is
// deliberately report-only — a human decides whether to apply the result.
// This one blends historical replay with live resolved model_picks (see
// lib/probability.js's weight_components, stored on every pick generated
// after this shipped) and, with --write, actually activates whichever
// vector performs best on live data. Below a live-sample threshold it
// never auto-activates anything — see lib/backtest/run-weight-tuning.js.
//
// Also refreshes data/calibration/historical-weight-components.json, the
// cached replay dump app/api/cron/tune-weights/route.js reads instead of
// redoing the full walk-forward replay (which needs the data/retrosheet/**
// corpus) on every cron tick.
//
// Usage:
//   node --env-file=.env.local scripts/backtest/tune-weights-live.js
//   node --env-file=.env.local scripts/backtest/tune-weights-live.js --write

import { writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { createClient } from "@supabase/supabase-js";
import { buildSeasonFeatures } from "../../lib/backtest/season-stats.js";
import { computeWalkForwardElo } from "../../lib/backtest/elo-walkforward.js";
import { getModelProbabilityComponents, setEloRatings } from "../../lib/probability.js";
import { fetchLiveWeightRows } from "../../lib/backtest/live-weight-rows.js";
import { runWeightTuning } from "../../lib/backtest/run-weight-tuning.js";

const write = process.argv.includes("--write");

function buildHistoricalComponentRows() {
  const officialGames = JSON.parse(readFileSync(join(process.cwd(), "data/games.json"), "utf8"));
  const { perGame: eloPerGame } = computeWalkForwardElo(officialGames);
  const seasonFeatures = buildSeasonFeatures();

  const queues = new Map();
  officialGames.forEach((g, i) => {
    const key = `${g.date}|${g.homeCode}|${g.awayCode}`;
    const arr = queues.get(key) ?? [];
    arr.push(i);
    queues.set(key, arr);
  });

  const rows = [];
  for (const feat of seasonFeatures) {
    const key = `${feat.date}|${feat.homeTeamCode}|${feat.awayTeamCode}`;
    const officialIdx = queues.get(key)?.shift();
    if (officialIdx == null) continue;
    const official = officialGames[officialIdx];
    const elo = eloPerGame[officialIdx];

    setEloRatings({ [official.homeTeam]: elo.preGameHomeElo, [official.awayTeam]: elo.preGameAwayElo });
    const components = getModelProbabilityComponents(
      { homeTeam: official.homeTeam, awayTeam: official.awayTeam }, feat.mlb
    );

    rows.push({ components, outcome: official.homeWon ? 1 : 0, season: feat.date.slice(0, 4) });
  }
  return rows;
}

async function main() {
  const historicalRows = buildHistoricalComponentRows();

  const cachePath = join(process.cwd(), "data/calibration/historical-weight-components.json");
  writeFileSync(cachePath, JSON.stringify(historicalRows) + "\n");
  console.log(`Refreshed ${cachePath} (${historicalRows.length} historical rows).`);

  let liveRows = [];
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    liveRows = await fetchLiveWeightRows(supabase);

    if (!liveRows.length) {
      console.warn("No live picks with weight_components yet — those only exist on picks generated after this shipped.");
    }

    const result = await runWeightTuning(supabase, { historicalRows, liveRows, write, source: "cli" });

    console.log(`\nSearch: baseline Brier=${result.baselineBrier.toFixed(4)} -> candidate Brier=${result.candidateBrier.toFixed(4)} (${result.historicalCount} historical + ${result.liveCount} live)`);
    if (result.changes.length) {
      console.log(`Changes (${result.changes.length}):`);
      for (const c of result.changes) console.log(`  pass ${c.pass}: ${c.param}  ${c.from} -> ${c.to}`);
    } else {
      console.log("No coordinate step improved Brier on the combined rows.");
    }

    if (!write) {
      console.log("\n--write not passed: not persisted to Supabase.");
    } else if (result.selection === "insufficient-live-data") {
      console.log(`\nOnly ${result.liveCount} live picks with weight_components — recorded candidate id=${result.weightsId} but did NOT activate it. Active weights unchanged.`);
    } else if (result.selection === "new-fit-is-best") {
      console.log(`\nToday's candidate is the best-scoring vector on live data (Brier=${result.bestLiveBrier.toFixed(4)}) — activated as id=${result.weightsId}.`);
    } else if (result.selection === "kept-past-weights") {
      console.log(`\nA past vector still outscores today's candidate on live data (Brier=${result.bestLiveBrier.toFixed(4)}) — kept id=${result.weightsId} active instead.`);
    }
  } catch (err) {
    console.error("\nLive weight-tuning step failed (historical-weight-components.json cache was still refreshed above):", err.message);
    if (write) process.exitCode = 1;
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
