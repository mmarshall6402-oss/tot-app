#!/usr/bin/env node
// scripts/backtest/compute-elo-splits.js
//
// Computes seven historical, analysis-only Elo variants per team (Overall,
// Home, Away, vs LHP, vs RHP, a synthetic Bullpen index, and a self-contained
// Last-30-Days form rating) and writes data/elo_splits.json. Purely static —
// reads data/games.json + data/retrosheet/*, no Supabase, no live model
// changes. See /root/.claude/plans/hazy-purring-treehouse.md for the design.
//
// Usage:
//   node scripts/backtest/compute-elo-splits.js
//   npm run elo-splits

import { readFileSync, readdirSync, writeFileSync } from "fs";
import { join } from "path";
import { parseEventFile } from "../../lib/backtest/retrosheet-parser.js";
import { loadRosters } from "../../lib/backtest/roster.js";
import { buildSeasonFeatures } from "../../lib/backtest/season-stats.js";
import {
  computeHomeAwayElo,
  computeHandElo,
  computeRecentFormElo,
  computeBullpenEloIndex,
} from "../../lib/backtest/elo-splits.js";

const ROOT = process.cwd();

function loadGames() {
  return JSON.parse(readFileSync(join(ROOT, "data/games.json"), "utf8"));
}

function loadOverallElo() {
  return JSON.parse(readFileSync(join(ROOT, "data/elo_ratings.json"), "utf8"));
}

// Builds Map<"date|homeCode|awayCode", { homeHand, awayHand }> where
// homeHand/awayHand are the OPPOSING starter's throwing hand — i.e. homeHand
// is what the home team's lineup faced (the away starter), and vice versa.
function buildStarterHandMap(rosters) {
  const dir = join(ROOT, "data/retrosheet");
  const files = readdirSync(dir).filter(f => f.endsWith(".EVA") || f.endsWith(".EVN"));
  const map = new Map();

  for (const file of files) {
    const text = readFileSync(join(dir, file), "utf8");
    for (const game of parseEventFile(text)) {
      const homeHand = rosters.get(game.awayStarterId)?.throws;
      const awayHand = rosters.get(game.homeStarterId)?.throws;
      if (homeHand || awayHand) {
        map.set(`${game.date}|${game.homeTeamCode}|${game.awayTeamCode}`, { homeHand, awayHand });
      }
    }
  }

  return map;
}

function round(n) {
  return typeof n === "number" ? Math.round(n * 100) / 100 : null;
}

function main() {
  console.log("Loading games and rosters...");
  const games = loadGames();
  const overall = loadOverallElo();
  const rosters = loadRosters();

  console.log("Parsing retrosheet starter handedness...");
  const starterHandByGameKey = buildStarterHandMap(rosters);

  console.log("Computing Home/Away Elo...");
  const { home, away } = computeHomeAwayElo(games);

  console.log("Computing vs LHP/RHP Elo...");
  const { vsLHP, vsRHP } = computeHandElo(games, starterHandByGameKey);

  console.log("Computing Last-30-Days Elo...");
  const last30 = computeRecentFormElo(games, { windowDays: 30 });

  console.log("Computing Bullpen index...");
  const seasonFeatures = buildSeasonFeatures();
  const bullpen = computeBullpenEloIndex(seasonFeatures);

  const teams = Object.keys(overall);
  const splits = {};
  for (const team of teams) {
    splits[team] = {
      overall: round(overall[team]),
      home: round(home[team]),
      away: round(away[team]),
      vsLHP: round(vsLHP[team]),
      vsRHP: round(vsRHP[team]),
      bullpen: round(bullpen[team]),
      last30: round(last30[team]),
    };
  }

  const outPath = join(ROOT, "data/elo_splits.json");
  writeFileSync(outPath, JSON.stringify(splits, null, 2) + "\n");
  console.log(`Wrote ${teams.length} teams to ${outPath}`);
}

main();
