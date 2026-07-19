#!/usr/bin/env node
// scripts/backtest/run-logistic.js
//
// Trains and evaluates lib/backtest/logistic-model.js (the "new
// architecture" leg) against the exact same games/splits tier2-runner.js
// uses for the tuned linear model, so the two are directly comparable.
// Backtest-only — prints results, does not write anywhere.

import { readFileSync } from "fs";
import { join } from "path";
import { buildSeasonFeatures } from "../../lib/backtest/season-stats.js";
import { computeWalkForwardElo } from "../../lib/backtest/elo-walkforward.js";
import { parkWinAdj } from "../../lib/park-factors.js";
import { getModelProbability, setEloRatings } from "../../lib/probability.js";
import { brierScore, logLoss } from "../../lib/backtest/metrics.js";
import { vectorize, fitStandardizer, standardize, fitLogistic, predictLogistic } from "../../lib/backtest/logistic-model.js";

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
  const eloDiff = elo.preGameHomeElo - elo.preGameAwayElo + 35; // + home advantage, same as HOME_ADVANTAGE
  const x = vectorize(feat.mlb, eloDiff, parkWinAdj(official.homeTeam));

  setEloRatings({ [official.homeTeam]: elo.preGameHomeElo, [official.awayTeam]: elo.preGameAwayElo });
  const linearProb = getModelProbability({ homeTeam: official.homeTeam, awayTeam: official.awayTeam }, feat.mlb);

  rows.push({ season: feat.date.slice(0, 4), x, y: official.homeWon ? 1 : 0, linearProb });
}

function evalSet(rows, model, scaler) {
  const X = standardize(rows.map(r => r.x), scaler);
  const preds = rows.map((r, i) => ({ p: predictLogistic(model, X[i]), outcome: r.y }));
  return { brier: brierScore(preds), logLoss: logLoss(preds) };
}

function evalLinear(rows) {
  const preds = rows.map(r => ({ p: r.linearProb, outcome: r.y }));
  return { brier: brierScore(preds), logLoss: logLoss(preds) };
}

function trainAndReport(trainSeasons, holdoutSeason) {
  const trainRows = rows.filter(r => trainSeasons.includes(r.season));
  const holdoutRows = rows.filter(r => r.season === holdoutSeason);

  const scaler = fitStandardizer(trainRows.map(r => r.x));
  const Xtrain = standardize(trainRows.map(r => r.x), scaler);
  const ytrain = trainRows.map(r => r.y);
  const model = fitLogistic(Xtrain, ytrain, { l2: 5.0, lr: 0.3, epochs: 1500 });

  console.log(`\n=== Train ${trainSeasons.join("+")} (n=${trainRows.length}) -> Holdout ${holdoutSeason} (n=${holdoutRows.length}) ===`);
  console.log("  Logistic weights:", JSON.stringify(model.w.map(v => Math.round(v * 1000) / 1000)));

  const logTrain = evalSet(trainRows, model, scaler);
  const logHoldout = evalSet(holdoutRows, model, scaler);
  const linTrain = evalLinear(trainRows);
  const linHoldout = evalLinear(holdoutRows);

  console.log(`  Train:   linear Brier=${linTrain.brier.toFixed(4)} logloss=${linTrain.logLoss.toFixed(4)}  |  logistic Brier=${logTrain.brier.toFixed(4)} logloss=${logTrain.logLoss.toFixed(4)}`);
  console.log(`  Holdout: linear Brier=${linHoldout.brier.toFixed(4)} logloss=${linHoldout.logLoss.toFixed(4)}  |  logistic Brier=${logHoldout.brier.toFixed(4)} logloss=${logHoldout.logLoss.toFixed(4)}`);
}

trainAndReport(["2022", "2023"], "2024");
trainAndReport(["2022", "2023", "2024"], "2025");
