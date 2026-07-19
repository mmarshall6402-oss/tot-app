// lib/backtest/tier2-runner.js
//
// Tier 2: replays the REAL production getModelProbability(game, mlb) full
// 7-factor path against every historical game, using season-stats.js's
// walk-forward-reconstructed `mlb` object and elo-walkforward.js's
// walk-forward Elo — both built strictly from games before the current one.
//
// Also fits an isotonic recalibration layer on a strict time-based split:
// trained on 2022+2023 seasons only, evaluated exclusively on the untouched
// 2024 season, so the reported improvement can't be an artifact of fitting
// and scoring on the same data.

import { readFileSync } from "fs";
import { join } from "path";
import { buildSeasonFeatures } from "./season-stats.js";
import { computeWalkForwardElo } from "./elo-walkforward.js";
import { getModelProbability, getCalibratedModelProbability, setEloRatings, setCalibrationCurve } from "../probability.js";
import { brierScore, logLoss, calibrationBuckets } from "./metrics.js";
import { fitCalibrationCurve } from "./calibration-fit.js";

function loadOfficialGames(seasons) {
  const all = JSON.parse(readFileSync(join(process.cwd(), "data/games.json"), "utf8"));
  if (!seasons?.length) return all;
  const years = new Set(seasons.map(String));
  return all.filter(g => years.has(g.date.slice(0, 4)));
}

// Doubleheaders can produce >1 row with the same date+home+away in both
// data/games.json and the Retrosheet parse. Join them in encounter order —
// both sources are chronologically sorted, so the Nth occurrence of a given
// date+matchup in one lines up with the Nth occurrence in the other.
function buildJoinQueues(officialGames) {
  const queues = new Map();
  officialGames.forEach((g, i) => {
    const key = `${g.date}|${g.homeCode}|${g.awayCode}`;
    const arr = queues.get(key) ?? [];
    arr.push(i);
    queues.set(key, arr);
  });
  return queues;
}

export function runTier2({ seasons } = {}) {
  const officialGames = loadOfficialGames(seasons);
  const { perGame: eloPerGame } = computeWalkForwardElo(officialGames);
  const joinQueues = buildJoinQueues(officialGames);

  const seasonFeatures = buildSeasonFeatures().filter(f => !seasons?.length || seasons.map(String).includes(f.date.slice(0, 4)));

  const rows = [];
  for (const feat of seasonFeatures) {
    const key = `${feat.date}|${feat.homeTeamCode}|${feat.awayTeamCode}`;
    const queue = joinQueues.get(key);
    const officialIdx = queue?.shift();
    if (officialIdx == null) continue; // no matching official record — skip rather than guess

    const official = officialGames[officialIdx];
    const elo = eloPerGame[officialIdx];

    setEloRatings({ [official.homeTeam]: elo.preGameHomeElo, [official.awayTeam]: elo.preGameAwayElo });
    const modelProb = getModelProbability({ homeTeam: official.homeTeam, awayTeam: official.awayTeam }, feat.mlb);

    rows.push({
      date: feat.date,
      season: feat.date.slice(0, 4),
      homeTeam: official.homeTeam,
      awayTeam: official.awayTeam,
      homeScore: official.homeScore,
      awayScore: official.awayScore,
      homeWon: official.homeWon,
      modelProb,
      outcome: official.homeWon ? 1 : 0,
      features: feat.mlb,
      preGameElo: { home: elo.preGameHomeElo, away: elo.preGameAwayElo },
    });
  }

  // ── Time-based isotonic recalibration: fit on 2022+2023, evaluate on 2024 ──
  // 2025 gets its own separate evaluation, using the SAME 2022-2023 fit — it's
  // a stronger holdout than 2024 since it wasn't even part of the original
  // archive this backtest was built against, added only after the fact.
  const trainRows = rows.filter(r => r.season === "2022" || r.season === "2023");
  const eval2024Rows = rows.filter(r => r.season === "2024");
  const eval2025Rows = rows.filter(r => r.season === "2025");

  const curve = fitCalibrationCurve(rows, { trainSeasons: ["2022", "2023"] });
  setCalibrationCurve(curve);

  // Recompute via the actual shipping getCalibratedModelProbability() wrapper
  // (not a parallel isotonicPredict call) so this harness validates the exact
  // function that will run in production, per-row Elo restored from the walk-
  // forward pass above so the wrapper's internal getModelProbability() call
  // reproduces the same raw probability it produced the first time.
  function calibratedProb(row) {
    setEloRatings({ [row.homeTeam]: row.preGameElo.home, [row.awayTeam]: row.preGameElo.away });
    return getCalibratedModelProbability({ homeTeam: row.homeTeam, awayTeam: row.awayTeam }, row.features);
  }

  const summarize = preds => ({
    brier: brierScore(preds),
    logLoss: logLoss(preds),
    calibration: calibrationBuckets(preds),
  });
  const summarizeHoldout = evalRows => ({
    beforeCalibration: summarize(evalRows.map(r => ({ p: r.modelProb, outcome: r.outcome }))),
    afterIsotonicCalibration: summarize(evalRows.map(r => ({ p: calibratedProb(r), outcome: r.outcome }))),
  });

  const allPredsRaw = rows.map(r => ({ p: r.modelProb, outcome: r.outcome }));

  const metrics = {
    gameCount: rows.length,
    trainCount: trainRows.length,
    eval2024Count: eval2024Rows.length,
    eval2025Count: eval2025Rows.length,
    fullSample: summarize(allPredsRaw),
    holdout2024: summarizeHoldout(eval2024Rows),
    ...(eval2025Rows.length > 0 ? { holdout2025: summarizeHoldout(eval2025Rows) } : {}),
  };

  return {
    tier: "full_replay",
    seasonStart: rows[0]?.date ?? null,
    seasonEnd: rows[rows.length - 1]?.date ?? null,
    gameCount: rows.length,
    params: {
      calibrationSplit: "train=2022,2023; holdout=2024" + (eval2025Rows.length > 0 ? ",2025(true out-of-corpus)" : ""),
      seasons: seasons ?? "all",
    },
    metrics,
    rows: rows.map(r => ({
      date: r.date,
      home_team: r.homeTeam,
      away_team: r.awayTeam,
      home_score: r.homeScore,
      away_score: r.awayScore,
      home_won: r.homeWon,
      model_home_prob: r.modelProb,
      model_home_prob_calibrated: (r.season === "2024" || r.season === "2025") ? calibratedProb(r) : null,
      features: r.features,
    })),
  };
}
