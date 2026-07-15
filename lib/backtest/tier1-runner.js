// lib/backtest/tier1-runner.js
//
// Tier 1: replays the REAL production fallback path of getModelProbability()
// (the `mlb == null` branch: Elo + park factor, no stat feed) against every
// historical game in data/games.json, using walk-forward-reconstructed Elo
// so no game's own outcome ever leaks into its own prediction.
//
// This tier has zero gaps or approximations: every input is either a real
// recorded fact (final score, park factor) or a documented, deterministic
// reconstruction (Elo from a 1500 seed, replayed with the exact production
// formula). It's a legitimate, fully-defensible calibration result on its
// own, independent of Tier 2/3.

import { readFileSync } from "fs";
import { join } from "path";
import { computeWalkForwardElo } from "./elo-walkforward.js";
import { getModelProbability, setEloRatings } from "../probability.js";
import { getParkFactor } from "../park-factors.js";
import { brierScore, logLoss, calibrationBuckets, isotonicFit, isotonicPredict } from "./metrics.js";

const HOME_ADVANTAGE = 35;

function rawEloProb(homeElo, awayElo, homeAdvantage = HOME_ADVANTAGE) {
  return 1 / (1 + Math.pow(10, (awayElo - homeElo - homeAdvantage) / 400));
}

function loadGames(seasons) {
  const all = JSON.parse(readFileSync(join(process.cwd(), "data/games.json"), "utf8"));
  if (!seasons?.length) return all;
  const years = new Set(seasons.map(String));
  return all.filter(g => years.has(g.date.slice(0, 4)));
}

// seasons: e.g. [2022,2023,2024], or omit for all available games.
export function runTier1({ seasons } = {}) {
  const games = loadGames(seasons);
  const { perGame } = computeWalkForwardElo(games);

  const rows = games.map((game, i) => {
    const { preGameHomeElo, preGameAwayElo } = perGame[i];

    // Inject only this game's two teams' pre-game ratings — eloProb() falls
    // back to 1500 for any team not present, so a per-game scoped table is
    // both correct and avoids holding the whole ratings history in memory.
    setEloRatings({ [game.homeTeam]: preGameHomeElo, [game.awayTeam]: preGameAwayElo });

    const modelProb = getModelProbability({ homeTeam: game.homeTeam, awayTeam: game.awayTeam }, null);
    const rawElo = rawEloProb(preGameHomeElo, preGameAwayElo);
    const outcome = game.homeWon ? 1 : 0;

    return {
      date: game.date,
      homeTeam: game.homeTeam,
      awayTeam: game.awayTeam,
      homeScore: game.homeScore,
      awayScore: game.awayScore,
      homeWon: game.homeWon,
      preGameHomeElo,
      preGameAwayElo,
      parkFactor: getParkFactor(game.homeTeam),
      modelProb,
      rawElo,
      outcome,
    };
  });

  const modelPreds = rows.map(r => ({ p: r.modelProb, outcome: r.outcome }));
  const rawEloPreds = rows.map(r => ({ p: r.rawElo, outcome: r.outcome }));
  const alwaysHalfPreds = rows.map(r => ({ p: 0.5, outcome: r.outcome }));

  // Bonus: an isotonic recalibration fit on the FULL Tier-1 set is not the
  // headline number (that's Tier 2's time-split recalibration) but is cheap
  // to include here as a sanity signal on the Elo-only fallback path too.
  const controlPoints = isotonicFit(modelPreds.map(({ p, outcome }) => ({ x: p, y: outcome })));
  const modelCalibratedPreds = modelPreds.map(({ p, outcome }) => ({
    p: isotonicPredict(controlPoints, p),
    outcome,
  }));

  const summarize = preds => ({
    brier: brierScore(preds),
    logLoss: logLoss(preds),
    calibration: calibrationBuckets(preds),
  });

  const metrics = {
    gameCount: rows.length,
    baselines: {
      always50: summarize(alwaysHalfPreds),
      rawElo: summarize(rawEloPreds),
    },
    model: summarize(modelPreds),
    modelIsotonicRecalibrated: summarize(modelCalibratedPreds),
  };

  return {
    tier: "elo_only",
    seasonStart: rows[0]?.date ?? null,
    seasonEnd: rows[rows.length - 1]?.date ?? null,
    gameCount: rows.length,
    params: { k: 20, homeAdvantage: HOME_ADVANTAGE, eloSeed: 1500, seasons: seasons ?? "all" },
    metrics,
    rows: rows.map(r => ({
      date: r.date,
      home_team: r.homeTeam,
      away_team: r.awayTeam,
      home_score: r.homeScore,
      away_score: r.awayScore,
      home_won: r.homeWon,
      model_home_prob: r.modelProb,
      features: { preGameHomeElo: r.preGameHomeElo, preGameAwayElo: r.preGameAwayElo, parkFactor: r.parkFactor, rawElo: r.rawElo },
    })),
  };
}
