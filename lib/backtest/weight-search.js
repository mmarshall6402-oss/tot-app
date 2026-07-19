// lib/backtest/weight-search.js
//
// Backtest-driven coordinate-ascent search over lib/probability.js's named
// WEIGHTS constants (see Phase 0 refactor). Reuses the exact production
// getModelProbability() — this is the same "vary a constant, check the
// backtest evidence" method used in commit 5aad788, just automated and
// bounded to a coordinate search instead of manual trial and error.
//
// Robustness bar given only 4 seasons of data: a candidate weight change is
// only accepted if it improves (or ties) Brier score on EACH of 2022, 2023,
// and 2024 individually — not just on average — so a change that helps one
// season by chance while quietly hurting another gets rejected. 2025 is never
// used during search; it's evaluated once at the end as a pure confirmatory
// holdout.
//
// This module does NOT mutate lib/probability.js. It returns a recommended
// weight vector and the before/after evidence for a human to review before
// anyone edits WEIGHTS in probability.js itself.

import { readFileSync } from "fs";
import { join } from "path";
import { buildSeasonFeatures } from "./season-stats.js";
import { computeWalkForwardElo } from "./elo-walkforward.js";
import { getModelProbability, setEloRatings, WEIGHTS } from "../probability.js";
import { brierScore, logLoss } from "./metrics.js";

// ─── Build once, reuse for every weight evaluation (cheap re-scoring) ──────

function loadOfficialGames() {
  return JSON.parse(readFileSync(join(process.cwd(), "data/games.json"), "utf8"));
}

export function buildEvalRows() {
  const officialGames = loadOfficialGames();
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
    rows.push({
      season: feat.date.slice(0, 4),
      homeTeam: official.homeTeam,
      awayTeam: official.awayTeam,
      outcome: official.homeWon ? 1 : 0,
      mlb: feat.mlb,
      preGameElo: { home: elo.preGameHomeElo, away: elo.preGameAwayElo },
    });
  }
  return rows;
}

// Recomputes getModelProbability() for every row under whatever WEIGHTS
// values are currently live (WEIGHTS is mutated in place by the search below,
// and getModelProbability reads WEIGHTS.* at call time — see lib/probability.js).
function scoreRows(rows) {
  return rows.map(r => {
    setEloRatings({ [r.homeTeam]: r.preGameElo.home, [r.awayTeam]: r.preGameElo.away });
    const p = getModelProbability({ homeTeam: r.homeTeam, awayTeam: r.awayTeam }, r.mlb);
    return { p, outcome: r.outcome };
  });
}

function brierBySeasson(rows, seasons) {
  const out = {};
  for (const season of seasons) {
    const preds = scoreRows(rows.filter(r => r.season === season));
    out[season] = brierScore(preds);
  }
  return out;
}

// ─── Coordinate-ascent search ───────────────────────────────────────────────
//
// paramSpecs: [{ name, candidates: [values to try, including current] }]
// Only top-level factor-scale constants are searched — the ones that set
// each signal's overall share of the blend — not every sub-weight inside
// pitcherScoreFromStats/bullpenScore, to keep the search space small and the
// result interpretable (mirrors how 5aad788 tuned filter.js's top-level
// blend constants, not its internal scoring sub-weights).
export function searchWeights({
  rows,
  trainSeasons = ["2022", "2023", "2024"],
  paramSpecs,
  passes = 2,
} = {}) {
  const trainRows = rows.filter(r => trainSeasons.includes(r.season));
  const baseline = { ...WEIGHTS };

  let current = { ...WEIGHTS };
  let currentBySeasson = brierBySeasson(trainRows, trainSeasons);
  const log = [];

  for (let pass = 0; pass < passes; pass++) {
    for (const { name, candidates } of paramSpecs) {
      let bestValue = current[name];
      let bestBySeasson = currentBySeasson;
      let improved = false;

      for (const candidate of candidates) {
        if (candidate === bestValue) continue;
        WEIGHTS[name] = candidate;
        const trialBySeasson = brierBySeasson(trainRows, trainSeasons);
        WEIGHTS[name] = current[name]; // restore before deciding

        // Accept only if it improves-or-ties EVERY training season vs the
        // current best-so-far for this param, with at least one strict
        // improvement (otherwise nothing ever moves).
        const allSeasonsOk = trainSeasons.every(s => trialBySeasson[s] <= bestBySeasson[s] + 1e-12);
        const anyStrictlyBetter = trainSeasons.some(s => trialBySeasson[s] < bestBySeasson[s] - 1e-9);

        if (allSeasonsOk && anyStrictlyBetter) {
          bestValue = candidate;
          bestBySeasson = trialBySeasson;
          improved = true;
        }
      }

      if (improved) {
        log.push({ pass, param: name, from: current[name], to: bestValue, before: currentBySeasson, after: bestBySeasson });
        current[name] = bestValue;
        currentBySeasson = bestBySeasson;
        WEIGHTS[name] = bestValue;
      } else {
        WEIGHTS[name] = current[name];
      }
    }
  }

  // Restore production weights — this function must never leave WEIGHTS
  // mutated as a side effect. Callers decide whether/how to apply `recommended`.
  for (const k of Object.keys(baseline)) WEIGHTS[k] = baseline[k];

  return {
    baseline,
    baselineBySeasson: brierBySeasson(trainRows, trainSeasons),
    recommended: current,
    recommendedBySeasson: currentBySeasson,
    changes: log,
  };
}

// Evaluate a specific weight vector against the untouched 2025 holdout —
// call this ONCE, after search, as a confirmatory look, never as part of
// the search loop itself.
export function evaluateHoldout(rows, weights, season = "2025") {
  const baseline = { ...WEIGHTS };
  for (const k of Object.keys(weights)) WEIGHTS[k] = weights[k];
  const preds = scoreRows(rows.filter(r => r.season === season));
  for (const k of Object.keys(baseline)) WEIGHTS[k] = baseline[k];
  return { brier: brierScore(preds), logLoss: logLoss(preds), n: preds.length };
}
