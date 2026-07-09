/**
 * lib/filter-nfl.js
 *
 * NFL AND-gate filter — a sibling to lib/filter.js (MLB), not a retrofit.
 * MLB's filter encodes MLB-specific assumptions (Coors exclusion, pitcher IP floors,
 * bullpen-fatigue rule, -300 juice cutoff tuned against years of MLB closing lines)
 * that don't generalize to NFL. This file reuses only what's genuinely market-agnostic:
 * edge math (lib/edge.js), variance merging, confidence-category caps, the SAFE_PASS
 * error wrapper, and CLEAN/BET/PASS/TRAP verdict tiering.
 *
 * Launch conservative: there's no resolved NFL pick history yet to calibrate against,
 * so the CLEAN tier is disabled (cap at BET) and the edge floor is wider than MLB's
 * hand-tuned 3.0%. Loosen once a real track record accumulates.
 */

import { americanToDecimal, decimalToImplied, removeVig } from "./edge.js";
import { getNFLModelUncertainty } from "./nfl-probability.js";

const MIN_CONFIDENCE  = 6.0;
const MIN_TRUE_EDGE   = 0.045; // 4.5% — wider than MLB's 3.0%, no track record yet to tighten against
const JUICE_KILL_ODDS = -300;

function juiceCheck(odds) {
  if (!odds) return { pass: true, note: null };
  if (odds <= JUICE_KILL_ODDS) return { pass: false, note: "JUICE_KILL (-300+)" };
  if (odds < -250) return { pass: true, note: "JUICE_WARNING: reduce size" };
  return { pass: true, note: null };
}

// ─── Variance merging (shared primitive — same shape as lib/filter.js) ───

const VARIANCE_RANK = { LOW: 0, MED: 1, HIGH: 2 };
function mergeVariance(...levels) {
  return ["LOW", "MED", "HIGH"][Math.max(...levels.map(l => VARIANCE_RANK[l] ?? 0))];
}

// NFL has no single point-of-failure like an MLB starting pitcher — variance here
// tracks how complete the team-stats picture is for each side.
function sideVariance(stats) {
  if (!stats || stats.pointsForPerGame == null) return "HIGH";
  const gp = (stats.wins ?? 0) + (stats.losses ?? 0) + (stats.ties ?? 0);
  if (gp < 4) return "MED"; // early-season small sample
  if (stats.last3NetDiff == null || stats.daysRest == null) return "MED";
  return "LOW";
}

function dataVariance(home, away) {
  return mergeVariance(sideVariance(home), sideVariance(away));
}

// ─── Confidence score (0–10) — additive, category-capped (same shape as MLB) ───

const CONF_CAPS = {
  variance: { min: -2.5, max: 1.0 },
  edge:     { min: -1.5, max: 1.5 },
  market:   { min: -1.5, max: 0.5 },
};
const clampAdj = (v, cat) => Math.max(CONF_CAPS[cat].min, Math.min(CONF_CAPS[cat].max, v));

function computeConfidence({ variance, trueEdgePct, marketImplied }) {
  const reasons = [];

  let vAdj = 0;
  if (variance === "LOW")  { vAdj += 1.0; reasons.push("+1 low variance (complete data)"); }
  if (variance === "MED")  { vAdj -= 0.5; reasons.push("-0.5 med variance (partial data / small sample)"); }
  if (variance === "HIGH") { vAdj -= 2.0; reasons.push("-2 high variance (missing data)"); }
  const vCapped = clampAdj(vAdj, "variance");
  if (vCapped !== vAdj) reasons.push(`[variance cap: ${vAdj.toFixed(1)} → ${vCapped.toFixed(1)}]`);

  let eAdj = 0;
  if (trueEdgePct >= 8)      { eAdj += 1.5; reasons.push("+1.5 large edge"); }
  else if (trueEdgePct >= 5) { eAdj += 0.8; reasons.push("+0.8 solid edge"); }
  else if (trueEdgePct < 3)  { eAdj -= 1.0; reasons.push("-1.0 thin edge"); }
  const eCapped = clampAdj(eAdj, "edge");

  let mAdj = 0;
  // NFL markets are sharper/lower-volume than MLB's — a model disagreeing hard with a
  // strong market consensus is more often wrong than right with no track record yet.
  if (marketImplied != null && marketImplied < 0.35) {
    mAdj -= 1.0; reasons.push("-1.0 model picks a heavy market underdog");
  }
  const mCapped = clampAdj(mAdj, "market");

  const score = 4.5 + vCapped + eCapped + mCapped;
  return { score: Math.max(0, Math.min(10, score)), reasons };
}

// ─── AND-gate conditions ────────────────────────────────────────────────

function andGate({ confidence, variance, trueEdgePct, uncertainty, juice, marketImplied }) {
  const failures = [];

  if (confidence < MIN_CONFIDENCE)
    failures.push(`confidence ${confidence.toFixed(1)}/10 < ${MIN_CONFIDENCE}`);

  if (variance === "HIGH")
    failures.push("variance HIGH (incomplete team data)");

  if (!juice.pass)
    failures.push(juice.note || "juice too high");

  const isUnderdog = marketImplied != null && marketImplied < 0.50;
  if (isUnderdog && confidence < 7.5)
    failures.push(`underdog pick requires confidence ≥7.5 (have ${confidence.toFixed(1)})`);

  if (trueEdgePct < MIN_TRUE_EDGE * 100)
    failures.push(`true edge ${trueEdgePct.toFixed(1)}% < ${(MIN_TRUE_EDGE * 100).toFixed(1)}%`);

  if (trueEdgePct / 100 < uncertainty)
    failures.push(`edge (${trueEdgePct.toFixed(1)}%) < model uncertainty (±${(uncertainty * 100).toFixed(0)}%) — noise, not signal`);

  return failures;
}

// ─── Main export ──────────────────────────────────────────────────────────
// Wrapped in try-catch: a bug in filter logic must never take down the whole
// API response. One bad game returns a safe PASS; everything else still loads.

const SAFE_PASS = {
  verdict: "PASS", confidence: 0, confidenceOf: 10,
  trueEdgePct: 0, rawEdgePct: 0,
  trueWinProbPct: 50, marketImpliedPct: 50,
  variance: "HIGH", flags: ["FILTER_ERROR"], failures: ["filter error — see server logs"],
  confidenceReasons: [], juiceNote: null,
  uncertaintyPct: 0, snr: 0, marketType: "moneyline",
};

export function applyNFLFilterLayer(pick, game, nfl, modelProb, opts = {}) {
  try {
    return _applyNFLFilterLayer(pick, game, nfl, modelProb, opts);
  } catch (e) {
    console.error("[filter-nfl] applyNFLFilterLayer threw:", e?.message, { pick, home: game?.homeTeam, away: game?.awayTeam });
    return { ...SAFE_PASS };
  }
}

// marketType: "moneyline" | "spread" | "total". For "spread", modelProb must be the
// spread-cover probability (getNFLSpreadCoverProbability); for "total", modelProb must
// be the over probability (getNFLTotalOverProbability) and pick must be "Over"/"Under" —
// the caller chooses which model output to pass in.
function _applyNFLFilterLayer(pick, game, nfl, modelProb, { marketType = "moneyline" } = {}) {
  const pickIsHome = pick === game.homeTeam;
  const pickIsOver = pick === "Over";
  const variance = dataVariance(nfl?.home, nfl?.away);
  const pickModelProb = marketType === "total"
    ? (pickIsOver ? modelProb : 1 - modelProb)
    : (pickIsHome ? modelProb : 1 - modelProb);

  let marketImplied, pickOdds;
  if (marketType === "spread") {
    const homeOdds = game.homeSpreadOdds;
    const awayOdds = game.awaySpreadOdds;
    if (homeOdds == null || awayOdds == null) {
      return { ...SAFE_PASS, failures: ["no spread market line — edge undefined"], variance, marketType };
    }
    const { fairHome, fairAway } = removeVig(
      decimalToImplied(americanToDecimal(homeOdds)),
      decimalToImplied(americanToDecimal(awayOdds))
    );
    marketImplied = pickIsHome ? fairHome : fairAway;
    pickOdds = pickIsHome ? homeOdds : awayOdds;
  } else if (marketType === "total") {
    const overOdds = game.overOdds;
    const underOdds = game.underOdds;
    if (overOdds == null || underOdds == null) {
      return { ...SAFE_PASS, failures: ["no total market line — edge undefined"], variance, marketType };
    }
    const { fairHome: fairOver, fairAway: fairUnder } = removeVig(
      decimalToImplied(americanToDecimal(overOdds)),
      decimalToImplied(americanToDecimal(underOdds))
    );
    marketImplied = pickIsOver ? fairOver : fairUnder;
    pickOdds = pickIsOver ? overOdds : underOdds;
  } else {
    marketImplied = pickIsHome ? game.homeImplied : game.awayImplied; // already vig-free
    pickOdds = pickIsHome ? game.homeOdds : game.awayOdds;
  }

  if (marketImplied == null || isNaN(marketImplied)) {
    return { ...SAFE_PASS, failures: ["no market line — edge undefined"], variance, marketType };
  }

  // Blend model probability toward market. Tighter ceiling than MLB's (0.38 LOW-variance
  // blend) since there's no resolved-pick history yet to justify trusting the model that much.
  const blend = variance === "HIGH" ? 0.10 : variance === "MED" ? 0.18 : 0.28;
  const trueWinProb  = marketImplied + (pickModelProb - marketImplied) * blend;
  const trueEdgeFrac = trueWinProb - marketImplied;
  const trueEdgePct  = trueEdgeFrac * 100;

  const juice = juiceCheck(pickOdds);
  const uncertainty = getNFLModelUncertainty(game, nfl);

  const { score: confidence, reasons: confidenceReasons } = computeConfidence({
    variance, trueEdgePct, marketImplied,
  });

  const failures = andGate({ confidence, variance, trueEdgePct, uncertainty, juice, marketImplied });

  // No CLEAN tier in Phase 1 — cap at BET. TRAP when the blended edge is actually
  // negative (the market is more right than the model after blending toward it).
  let verdict;
  if (trueEdgeFrac < 0) verdict = "TRAP";
  else if (failures.length === 0) verdict = "BET";
  else verdict = "PASS";

  return {
    verdict,
    confidence:       parseFloat(confidence.toFixed(1)),
    confidenceOf:     10,
    trueEdgePct:      parseFloat(trueEdgePct.toFixed(2)),
    rawEdgePct:       parseFloat(trueEdgePct.toFixed(2)),
    trueWinProbPct:   parseFloat((trueWinProb * 100).toFixed(1)),
    marketImpliedPct: parseFloat((marketImplied * 100).toFixed(1)),
    variance,
    flags: [],
    failures,
    confidenceReasons,
    juiceNote: juice.note,
    uncertaintyPct: parseFloat((uncertainty * 100).toFixed(1)),
    snr: parseFloat((trueEdgePct / (uncertainty * 100)).toFixed(2)),
    marketType,
  };
}
