// lib/backtest/logistic-model.js
//
// Hand-rolled (no dependency) L2-regularized logistic regression — the "new
// architecture" leg of the model-improvement plan. Deliberately independent
// of probability.js's hand-tuned pitcherScore()/bullpenScore()/etc: it
// re-derives feature weights directly from raw stat diffs via gradient
// descent, rather than re-weighting the existing hand-picked sub-scores,
// so it's a genuinely different way of arriving at a probability rather
// than a relabeling of the same formula.
//
// BACKTEST-ONLY. Not wired into any live code path. See the model-
// improvement plan's Phase 3: this file exists to test whether a small
// data-driven model can beat the tuned linear blend on holdout Brier/
// log-loss; it does not touch lib/probability.js, lib/filter.js, or any
// production route.
//
// Known limitation (inherited from season-stats.js): hardHitPct and Savant
// wOBA are permanently null in the backtest (not derivable from Retrosheet),
// so this model cannot learn weights for those two live-only signals and
// omits them entirely — it is trained only on features the backtest can
// actually supply.

function toNum(x) { const v = parseFloat(x); return Number.isNaN(v) ? null : v; }
function parseIP(raw) {
  if (!raw) return null;
  const [w, p = "0"] = String(raw).split(".");
  return parseInt(w, 10) + parseInt(p, 10) / 3;
}
function stabilize(value, mean, ip) {
  if (value == null) return mean;
  if (ip == null) return value;
  const trust = Math.min(1, ip / 90);
  return mean * (1 - trust) + value * trust;
}

const LEAGUE_ERA = 4.20, LEAGUE_XFIP = 3.85, LEAGUE_WHIP = 1.28, LEAGUE_KBB = 8.5;

// ─── Feature vectorization ───────────────────────────────────────────────
// Order matters — FEATURE_NAMES indexes align with the weight vector.

export const FEATURE_NAMES = [
  "pitcherEraXfipDiff", "pitcherKbbDiff", "pitcherWhipDiff",
  "bullpenEraDiff", "bullpenWhipDiff", "bullpenK9Diff",
  "lineupOpsDiff", "formDiff", "eloDiff", "parkFactor",
];

function pitcherFeatures(pitcher) {
  const ip = parseIP(pitcher?.inningsPitched);
  const era = toNum(pitcher?.era), xfip = toNum(pitcher?.xFip);
  const eraXfip = xfip != null ? stabilize(xfip, LEAGUE_XFIP, ip) : stabilize(era, LEAGUE_ERA, ip);
  const kbb = stabilize(toNum(pitcher?.kBBPct), LEAGUE_KBB, ip);
  const whip = stabilize(toNum(pitcher?.whip), LEAGUE_WHIP, ip);
  return { eraXfip, kbb, whip };
}

// game: {homeTeam, awayTeam}; mlb: the standard feature object; eloDiff:
// precomputed walk-forward (homeElo - awayElo) already including home-field.
export function vectorize(mlb, eloDiff, parkFactor) {
  const hp = pitcherFeatures(mlb?.homePitcher);
  const ap = pitcherFeatures(mlb?.awayPitcher);

  const hBull = mlb?.homeBullpen, aBull = mlb?.awayBullpen;
  const bullpenEraDiff = (toNum(aBull?.era) ?? 4.2) - (toNum(hBull?.era) ?? 4.2);
  const bullpenWhipDiff = (toNum(aBull?.whip) ?? 1.35) - (toNum(hBull?.whip) ?? 1.35);
  const bullpenK9Diff = (toNum(hBull?.k9) ?? 8.5) - (toNum(aBull?.k9) ?? 8.5);

  const lineupOpsDiff = (toNum(mlb?.homeLineupOpsVsPitcher) ?? 0.730) - (toNum(mlb?.awayLineupOpsVsPitcher) ?? 0.730);

  const hForm = toNum(mlb?.homeForm?.ops) ?? 0.720;
  const aForm = toNum(mlb?.awayForm?.ops) ?? 0.720;
  const formDiff = hForm - aForm;

  return [
    ap.eraXfip - hp.eraXfip, // positive => home pitcher better (lower ERA/xFIP)
    hp.kbb - ap.kbb,
    ap.whip - hp.whip,
    bullpenEraDiff,
    bullpenWhipDiff,
    bullpenK9Diff,
    lineupOpsDiff,
    formDiff,
    eloDiff / 400,
    parkFactor ?? 0,
  ];
}

// ─── Feature standardization (mean/std) — required for gradient descent to
// converge sanely across features on very different scales (ERA diffs are
// O(1), OPS diffs are O(0.1), Elo diffs are O(1) after /400 above). ────────

export function fitStandardizer(X) {
  const n = X.length, d = X[0].length;
  const mean = new Array(d).fill(0);
  for (const row of X) for (let j = 0; j < d; j++) mean[j] += row[j] / n;
  const std = new Array(d).fill(0);
  for (const row of X) for (let j = 0; j < d; j++) std[j] += (row[j] - mean[j]) ** 2 / n;
  for (let j = 0; j < d; j++) std[j] = Math.sqrt(std[j]) || 1;
  return { mean, std };
}

export function standardize(X, { mean, std }) {
  return X.map(row => row.map((v, j) => (v - mean[j]) / std[j]));
}

// ─── Logistic regression: batch gradient descent + L2 ──────────────────────

function sigmoid(z) { return 1 / (1 + Math.exp(-z)); }

export function fitLogistic(X, y, { l2 = 1.0, lr = 0.1, epochs = 2000 } = {}) {
  const n = X.length, d = X[0].length;
  let w = new Array(d).fill(0);
  let b = 0;

  for (let epoch = 0; epoch < epochs; epoch++) {
    const gradW = new Array(d).fill(0);
    let gradB = 0;
    for (let i = 0; i < n; i++) {
      const z = b + X[i].reduce((s, x, j) => s + x * w[j], 0);
      const err = sigmoid(z) - y[i];
      for (let j = 0; j < d; j++) gradW[j] += err * X[i][j];
      gradB += err;
    }
    for (let j = 0; j < d; j++) w[j] -= lr * (gradW[j] / n + (l2 / n) * w[j]);
    b -= lr * (gradB / n);
  }
  return { w, b };
}

export function predictLogistic({ w, b }, x) {
  return sigmoid(b + x.reduce((s, v, j) => s + v * w[j], 0));
}
