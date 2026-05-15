/**
 * lib/filter.js
 *
 * Post-model filter layer. Applies:
 *   1. Pitcher quality checks + regression flags
 *   2. Variance classification (LOW / MED / HIGH)
 *   3. Park factor impact
 *   4. Market calibration (square vs sharp line compression)
 *   5. Juice/Kelly rules
 *   6. True edge calculation
 *   7. Verdict: CLEAN / SOFT / TRAP / PASS
 *
 * Design: each check is independent and additive — no single flag kills a pick,
 * but stacked flags will. The multiplier system preserves the raw model
 * probability while discounting confidence in the edge estimate.
 */

import { getParkFactor } from "./park-factors.js";
import { americanToDecimal } from "./edge.js";

// ─── Constants ────────────────────────────────────────────────────────────────

// When using square/soft book odds (SportsData.io), edges are overstated.
// Compress by subtracting this from raw edge before verdict classification.
// Empirically: square vs Pinnacle hold differential ~ 2.5–4%.
const SQUARE_LINE_COMPRESSION = 0.03;  // 3 percentage points

const CLEAN_EDGE_THRESHOLD = 0.04;    // 4% true edge
const SOFT_EDGE_THRESHOLD  = 0.01;    // 1% true edge

// ─── Pitcher flag detection ───────────────────────────────────────────────────

function pitcherFlags(pitcher) {
  if (!pitcher) return { flags: ["NO_PITCHER_DATA"], variance: "HIGH", score: 0 };

  const era  = parseFloat(pitcher.era)           ?? null;
  const whip = parseFloat(pitcher.whip)          ?? null;
  const k9   = parseFloat(pitcher.strikeoutsPer9) ?? null;
  const ip   = estimateIP(pitcher);

  const flags = [];

  // Small sample — ERA is unreliable below ~30 IP
  if (ip !== null && ip < 30) flags.push("SMALL_SAMPLE");

  // ERA < 2.00 + WHIP > 1.20 = LOB-luck regression candidate
  if (era !== null && era < 2.0 && whip !== null && whip > 1.20)
    flags.push("ERA_WHIP_MISMATCH");

  // Extreme ERA — unstable unless large sample
  if (era !== null && era > 5.5 && (ip === null || ip < 80)) flags.push("HIGH_ERA");

  // ERA > 5 but decent WHIP — could be HR-inflated (park-sensitive)
  if (era !== null && era > 5.0 && whip !== null && whip < 1.30)
    flags.push("HR_INFLATION_RISK");

  // Very low K9 + high WHIP = contact-batter with no margin for error
  if (k9 !== null && k9 < 5.5 && whip !== null && whip > 1.40) flags.push("LOW_K_HIGH_WHIP");

  // Compute composite quality score [-1, 1]
  const eraNorm  = era  !== null ? clamp((era  - 4.25) / 2.75 * -1, -1, 1) : 0;
  const whipNorm = whip !== null ? clamp((whip - 1.25) / 0.50 * -1, -1, 1) : 0;
  const k9Norm   = k9   !== null ? clamp((k9   - 8.50) / 3.50,      -1, 1) : 0;

  const score = eraNorm * 0.40 + whipNorm * 0.35 + k9Norm * 0.25;

  // Variance contribution from this pitcher
  let variance = "LOW";
  if (flags.length >= 2 || flags.includes("SMALL_SAMPLE") || flags.includes("HIGH_ERA"))
    variance = "HIGH";
  else if (flags.length === 1)
    variance = "MED";

  return { flags, variance, score };
}

function parseIP(raw) {
  if (!raw) return null;
  const [whole, partial = '0'] = String(raw).split('.');
  return parseInt(whole, 10) + parseInt(partial, 10) / 3;
}

function estimateIP(pitcher) {
  if (!pitcher) return null;
  // Use actual IP if available (from mlb route after our fix)
  const ip = parseIP(pitcher.inningsPitched);
  if (ip !== null) return ip;
  // Fallback heuristics when IP not in payload
  const era = parseFloat(pitcher.era);
  const whip = parseFloat(pitcher.whip);
  if (!isNaN(era) && !isNaN(whip)) {
    if (era === 0 || (era < 1.0 && whip > 1.3)) return 10;
    if (era < 1.5) return 20;
  }
  return null;
}

// ─── Park variance contribution ───────────────────────────────────────────────

function parkVariance(homeTeam) {
  const pf = getParkFactor(homeTeam);
  if (Math.abs(pf) >= 1.0) return "HIGH";   // Coors and equivalent
  if (Math.abs(pf) >= 0.35) return "MED";
  return "LOW";
}

// ─── Merge variance levels ────────────────────────────────────────────────────

const VARIANCE_RANK = { LOW: 0, MED: 1, HIGH: 2 };
function mergeVariance(...levels) {
  const max = Math.max(...levels.map(l => VARIANCE_RANK[l] ?? 0));
  return ["LOW", "MED", "HIGH"][max];
}

// ─── Market calibration ───────────────────────────────────────────────────────

function sharpImplied(pick, game) {
  // If we have SportsGameOdds with Pinnacle/sharp books, trust the line as-is.
  // If SportsData.io fallback: compress by SQUARE_LINE_COMPRESSION.
  const isSquareLine = game.source === "sportsdata" || !game.source;
  const compression  = isSquareLine ? SQUARE_LINE_COMPRESSION : 0;

  // The pick's market implied probability (already vig-removed in game object)
  const pickIsHome  = pick === game.homeTeam;
  const rawImplied  = pickIsHome ? game.homeImplied : game.awayImplied;

  // Compress: sharp market would have implied this pick at slightly higher probability
  return Math.min(0.90, rawImplied + compression);
}

// ─── Juice / Kelly check ──────────────────────────────────────────────────────

function juiceCheck(pickIsHome, game) {
  const pickOdds = pickIsHome ? game.homeOdds : game.awayOdds;
  if (!pickOdds) return { pass: true, note: null };

  const decOdds = americanToDecimal(pickOdds);
  const impliedOdds = 1 / decOdds;  // rough market-implied prob (pre-vig)

  if (pickOdds < -300) return { pass: false, note: "JUICE_KILL (-300+)" };
  if (pickOdds < -250) return { pass: true,  note: "JUICE_WARNING (-250 to -300): reduce size -15%" };
  return { pass: true, note: null };
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// ─── Closing line comparison ──────────────────────────────────────────────────
// Compares our pick direction to line movement (open → close).
// Contra-movement = sharp money fading us (warning signal).

function closingLineSignal(pickIsHome, game) {
  const openHome  = game.openHomeOdds;
  const closeHome = game.homeOdds;
  if (!openHome || !closeHome || openHome === closeHome) return { signal: "unknown" };

  const toImplied = (o) => o > 0 ? 100 / (o + 100) : Math.abs(o) / (Math.abs(o) + 100);
  const movement  = toImplied(closeHome) - toImplied(openHome); // positive = home became more favored
  const magnitude = Math.abs(movement);
  const aligned   = pickIsHome ? movement > 0 : movement < 0;

  if (magnitude < 0.01) return { signal: "flat" };
  if (magnitude >= 0.03 && aligned)  return { signal: "confirming", note: `+${(magnitude*100).toFixed(1)}pp` };
  if (magnitude >= 0.03 && !aligned) return { signal: "contra",     note: `-${(magnitude*100).toFixed(1)}pp` };
  return { signal: "minor" };
}

// ─── Main filter function ─────────────────────────────────────────────────────

/**
 * applyFilterLayer(pick, game, modelProb)
 *
 * pick     — the team name we're picking (homeTeam or awayTeam)
 * game     — full game object from fetchMLBOdds (has homeOdds, awayOdds, source, etc.)
 * mlb      — the matched mlb game record (has homePitcher, awayPitcher, homeBullpen, etc.)
 * modelProb — raw output of getModelProbability (home win probability [0,1])
 *
 * Returns an enriched object with verdict, trueEdge, variance, flags.
 */
export function applyFilterLayer(pick, game, mlb, modelProb) {
  const pickIsHome = pick === game.homeTeam;

  // Pitcher quality
  const homeP = pitcherFlags(mlb?.homePitcher);
  const awayP = pitcherFlags(mlb?.awayPitcher);

  // Collect all flags
  const allFlags = [
    ...homeP.flags.map(f => `HOME_SP_${f}`),
    ...awayP.flags.map(f => `AWAY_SP_${f}`),
  ];

  // Park factor
  const parkAdj = getParkFactor(game.homeTeam);  // runs, for display
  const pVariance = parkVariance(game.homeTeam);

  // Overall variance
  const variance = mergeVariance(homeP.variance, awayP.variance, pVariance);

  // True win probability: model with variance-aware confidence band
  // HIGH variance → widen uncertainty → shrink toward 0.5
  const shrinkFactor = variance === "HIGH" ? 0.75 : variance === "MED" ? 0.90 : 1.0;
  const pickModelProb = pickIsHome ? modelProb : (1 - modelProb);
  const trueWinProb   = 0.5 + (pickModelProb - 0.5) * shrinkFactor;

  // Sharp implied probability (market-calibrated)
  const sharpImpliedProb = sharpImplied(pick, game);

  // True edge
  const trueEdgeFrac = trueWinProb - sharpImpliedProb;

  // Juice check
  const juice = juiceCheck(pickIsHome, game);

  // Closing line comparison
  const lineSignal = closingLineSignal(pickIsHome, game);
  if (lineSignal.signal === "contra") allFlags.push("LINE_CONTRA");

  // Auto-kill conditions
  const isAutoKill = (
    !juice.pass ||
    (variance === "HIGH" && trueEdgeFrac < CLEAN_EDGE_THRESHOLD) ||
    (allFlags.includes("HOME_SP_HIGH_ERA") && allFlags.includes("AWAY_SP_HIGH_ERA"))
  );

  // Verdict — contra line movement downgrades CLEAN → SOFT
  let verdict;
  if (isAutoKill) {
    verdict = "PASS";
  } else if (trueEdgeFrac >= CLEAN_EDGE_THRESHOLD && variance !== "HIGH" && lineSignal.signal !== "contra") {
    verdict = "CLEAN";
  } else if (trueEdgeFrac >= SOFT_EDGE_THRESHOLD) {
    verdict = "SOFT";
  } else if (trueEdgeFrac < 0) {
    verdict = "TRAP";
  } else {
    verdict = "PASS";
  }

  return {
    verdict,
    trueEdgePct:      parseFloat((trueEdgeFrac * 100).toFixed(2)),
    trueWinProbPct:   parseFloat((trueWinProb   * 100).toFixed(1)),
    sharpImpliedPct:  parseFloat((sharpImpliedProb * 100).toFixed(1)),
    variance,
    flags:            allFlags,
    parkFactor:       parkAdj,
    juiceNote:        juice.note,
    lineSignal:       lineSignal.signal,
    lineNote:         lineSignal.note ?? null,
    homePitcherScore: parseFloat(homeP.score.toFixed(3)),
    awayPitcherScore: parseFloat(awayP.score.toFixed(3)),
    isSquareLine:     game.source === "sportsdata" || !game.source,
  };
}

/**
 * buildParlayCards(picks)
 *
 * picks — array of enriched picks (each with .verdict, .variance, .trueEdgePct, etc.)
 * Returns SAFE, BALANCED, AGGRESSIVE card arrays.
 */
export function buildParlayCards(picks) {
  const clean = picks.filter(p => p.filter?.verdict === "CLEAN");
  const soft  = picks.filter(p => p.filter?.verdict === "SOFT");

  const safeCard = clean
    .filter(p => p.filter.variance !== "HIGH")
    .slice(0, 3);

  const balancedCard = [
    ...clean.slice(0, 3),
    ...soft.filter(p => p.filter.variance !== "HIGH").slice(0, 2),
  ].slice(0, 5);

  const aggressiveCard = [
    ...clean,
    ...soft,
  ].slice(0, 5);

  return { safeCard, balancedCard, aggressiveCard };
}
