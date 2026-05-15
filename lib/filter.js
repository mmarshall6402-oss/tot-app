/**
 * lib/filter.js
 *
 * Sharp AND-gate filter. Every condition must pass independently.
 * One failure = PASS. No exceptions. No partial credit.
 *
 * Philosophy: some days there are zero bets. That is correct.
 * Forcing action is how bankrolls die.
 */

import { getParkFactor } from "./park-factors.js";
import { americanToDecimal } from "./edge.js";
import { getModelUncertainty } from "./probability.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const SQUARE_LINE_COMPRESSION = 0.03;
const MIN_CONFIDENCE          = 8.0;   // out of 10 — strict threshold
const MIN_IP_MEANINGFUL       = 35;    // innings pitched before trusting ERA/xFIP
const MIN_TRUE_EDGE           = 0.04;  // 4% minimum after market calibration

// ─── Pitcher sample size ──────────────────────────────────────────────────────

function parseIP(raw) {
  if (!raw) return null;
  const [w, p = "0"] = String(raw).split(".");
  return parseInt(w, 10) + parseInt(p, 10) / 3;
}

function pitcherFlags(pitcher) {
  if (!pitcher) return { flags: ["NO_PITCHER_DATA"], variance: "HIGH", score: 0 };

  const era  = parseFloat(pitcher.era)            ?? null;
  const whip = parseFloat(pitcher.whip)           ?? null;
  const xfip = parseFloat(pitcher.xFip)           ?? null;
  const kbb  = parseFloat(pitcher.kBBPct)         ?? null;
  const hh   = parseFloat(pitcher.hardHitPct)     ?? null;
  const ip   = parseIP(pitcher.inningsPitched);

  const flags = [];

  if (ip !== null && ip < MIN_IP_MEANINGFUL) flags.push("SMALL_SAMPLE");
  if (era !== null && era < 2.0 && whip !== null && whip > 1.20) flags.push("ERA_WHIP_MISMATCH");
  if (era !== null && xfip !== null && (xfip - era) > 1.20) flags.push("ERA_XFIP_GAP"); // ERA beating xFIP by >1.2 = regression incoming
  if (era !== null && era > 5.5 && (ip === null || ip < 80)) flags.push("HIGH_ERA");
  if (kbb !== null && kbb < 4.0 && whip !== null && whip > 1.40) flags.push("LOW_K_HIGH_WHIP");

  // Composite quality score [-1, 1]
  const primary = (xfip ?? era) ?? 4.20;
  const eraNorm  = Math.max(-1, Math.min(1, (primary - 4.25) / 2.75 * -1));
  const whipNorm = whip != null ? Math.max(-1, Math.min(1, (whip - 1.25) / 0.50 * -1)) : 0;
  const kbbNorm  = kbb  != null ? Math.max(-1, Math.min(1, (kbb  - 8.50) / 6.00))      : 0;
  const hhNorm   = hh   != null ? Math.max(-1, Math.min(1, (hh   - 35.5) / 9.00 * -1)) : 0;
  const score    = eraNorm * 0.40 + whipNorm * 0.30 + kbbNorm * 0.20 + hhNorm * 0.10;

  let variance = "LOW";
  if (flags.length >= 2 || flags.some(f => ["SMALL_SAMPLE","HIGH_ERA","NO_PITCHER_DATA"].includes(f))) variance = "HIGH";
  else if (flags.length === 1) variance = "MED";

  return { flags, variance, score };
}

function parkVariance(homeTeam) {
  const pf = getParkFactor(homeTeam);
  if (Math.abs(pf) >= 1.0) return "HIGH";
  if (Math.abs(pf) >= 0.35) return "MED";
  return "LOW";
}

const VARIANCE_RANK = { LOW: 0, MED: 1, HIGH: 2 };
function mergeVariance(...levels) {
  return ["LOW","MED","HIGH"][Math.max(...levels.map(l => VARIANCE_RANK[l] ?? 0))];
}

function sharpImplied(pick, game) {
  const isSquare   = game.source === "sportsdata" || !game.source;
  const compression = isSquare ? SQUARE_LINE_COMPRESSION : 0;
  const pickIsHome  = pick === game.homeTeam;
  const raw = pickIsHome ? game.homeImplied : game.awayImplied;
  return Math.min(0.90, raw + compression);
}

function juiceCheck(pickIsHome, game) {
  const odds = pickIsHome ? game.homeOdds : game.awayOdds;
  if (!odds) return { pass: true, note: null };
  if (odds < -300) return { pass: false, note: "JUICE_KILL (-300+)" };
  if (odds < -250) return { pass: true,  note: "JUICE_WARNING: reduce size" };
  return { pass: true, note: null };
}

function closingLineSignal(pickIsHome, game) {
  const openHome  = game.openHomeOdds;
  const closeHome = game.homeOdds;
  if (!openHome || !closeHome || openHome === closeHome) return { signal: "unknown" };
  const toI = (o) => o > 0 ? 100/(o+100) : Math.abs(o)/(Math.abs(o)+100);
  const mv  = toI(closeHome) - toI(openHome);
  const mag = Math.abs(mv);
  const aligned = pickIsHome ? mv > 0 : mv < 0;
  if (mag < 0.01) return { signal: "flat" };
  if (mag >= 0.03 && aligned)  return { signal: "confirming", note: `+${(mag*100).toFixed(1)}pp` };
  if (mag >= 0.03 && !aligned) return { signal: "contra",     note: `-${(mag*100).toFixed(1)}pp` };
  return { signal: "minor" };
}

// ─── Confidence score (0–10) ──────────────────────────────────────────────────
// Additive. Starts at 5. Bonuses for genuine edges. Deductions for risk factors.
// Threshold: 8/10 required to bet.

function computeConfidence({
  homeP, awayP,
  pickIsHome,
  variance,
  mlb,
  lineSignal,
  trueEdgePct,
}) {
  const pickedP  = pickIsHome ? homeP : awayP;
  const opposedP = pickIsHome ? awayP : homeP;
  let score = 5.0;
  const reasons = [];

  // Variance gate
  if (variance === "LOW") { score += 1.0; reasons.push("+1 low variance"); }
  if (variance === "MED") { score -= 0.5; reasons.push("-0.5 med variance"); }
  if (variance === "HIGH") { score -= 2.0; reasons.push("-2 high variance"); }

  // Pitcher sample size (pick side)
  const pickIP = parseIP(pickedP.ip ?? mlb?.[pickIsHome ? "homePitcher" : "awayPitcher"]?.inningsPitched);
  if (pickIP !== null && pickIP >= MIN_IP_MEANINGFUL) { score += 0.5; reasons.push("+0.5 meaningful IP"); }
  if (pickIP !== null && pickIP < MIN_IP_MEANINGFUL)  { score -= 1.5; reasons.push("-1.5 small sample"); }

  // Opposition pitcher small sample (free variance gift — be wary)
  const oppIP = parseIP(opposedP.ip ?? mlb?.[pickIsHome ? "awayPitcher" : "homePitcher"]?.inningsPitched);
  if (oppIP !== null && oppIP < 20) { score -= 0.5; reasons.push("-0.5 opp SP tiny sample"); }

  // Pitcher quality on pick side
  if (pickedP.score > 0.3)  { score += 0.5; reasons.push("+0.5 SP quality edge"); }
  if (pickedP.score < -0.2) { score -= 0.5; reasons.push("-0.5 SP quality deficit"); }

  // xFIP/ERA gap warning (regression incoming for pick-side pitcher)
  if (pickedP.flags.includes("ERA_XFIP_GAP")) { score -= 1.0; reasons.push("-1 ERA beats xFIP (regression risk)"); }
  if (pickedP.flags.includes("ERA_WHIP_MISMATCH")) { score -= 0.5; reasons.push("-0.5 ERA/WHIP mismatch"); }
  if (pickedP.flags.includes("HIGH_ERA")) { score -= 1.0; reasons.push("-1 high ERA"); }

  // Lineup vs handedness (meaningful signal when available)
  const lineupOps = pickIsHome ? mlb?.homeLineupOpsVsPitcher : mlb?.awayLineupOpsVsPitcher;
  if (lineupOps != null) {
    if (lineupOps >= 0.740) { score += 0.5; reasons.push("+0.5 lineup advantage vs pitcher hand"); }
    if (lineupOps <= 0.680) { score -= 0.5; reasons.push("-0.5 lineup disadvantaged vs pitcher hand"); }
  } else {
    score -= 0.5; // unknown lineups = uncertainty
    reasons.push("-0.5 no lineup confirmation");
  }

  // Rolling bullpen edge
  const bull = pickIsHome ? mlb?.homeBullpen : mlb?.awayBullpen;
  if (bull?.era != null) {
    if (bull.isRolling && parseFloat(bull.era) < 3.50) { score += 0.5; reasons.push("+0.5 bullpen rolling edge"); }
    if (parseFloat(bull.era) > 4.50) { score -= 0.5; reasons.push("-0.5 bullpen concern"); }
  }

  // Market movement
  if (lineSignal === "confirming") { score += 0.5; reasons.push("+0.5 line confirms"); }
  if (lineSignal === "contra")     { score -= 1.5; reasons.push("-1.5 line contradicts"); }

  // True edge magnitude
  if (trueEdgePct >= 8)  { score += 0.5; reasons.push("+0.5 large true edge"); }
  if (trueEdgePct <= 2)  { score -= 0.5; reasons.push("-0.5 thin true edge"); }

  return { score: Math.max(0, Math.min(10, score)), reasons };
}

// ─── AND-gate conditions ──────────────────────────────────────────────────────
// Every entry must pass. Returns list of failed conditions (empty = bet eligible).

function andGate({
  confidence,
  variance,
  homeP, awayP,
  pickIsHome,
  mlb,
  lineSignal,
  juice,
  game,
  trueEdgePct,
  uncertainty,
}) {
  const failures = [];

  if (confidence < MIN_CONFIDENCE)
    failures.push(`confidence ${confidence.toFixed(1)}/10 < ${MIN_CONFIDENCE}`);

  if (variance !== "LOW")
    failures.push(`variance ${variance} (must be LOW)`);

  // Both starters need meaningful sample
  const pickSide  = pickIsHome ? homeP : awayP;
  const opposSide = pickIsHome ? awayP : homeP;
  if (pickSide.flags.includes("SMALL_SAMPLE"))
    failures.push("pick-side SP small sample (<35 IP)");
  if (pickSide.flags.includes("NO_PITCHER_DATA"))
    failures.push("pick-side SP data missing");

  // No injury-return / regression risk on pick side
  if (pickSide.flags.includes("ERA_XFIP_GAP"))
    failures.push("pick-side SP ERA beats xFIP by >1.2 (regression risk)");

  // No rookie volatility on EITHER side (unpredictable outcomes)
  if (homeP.flags.includes("SMALL_SAMPLE") || awayP.flags.includes("SMALL_SAMPLE"))
    failures.push("at least one SP small sample (volatility risk on either side)");

  // Coors Field — permanent exclusion
  if (game.homeTeam === "Colorado Rockies")
    failures.push("Coors Field (park model cannot compensate)");

  // Underdog filter — only take dogs with extreme confidence
  const pickOdds = pickIsHome ? game.homeOdds : game.awayOdds;
  if (pickOdds !== null && pickOdds > 0 && confidence < 9.0)
    failures.push(`underdog pick requires confidence ≥9 (have ${confidence.toFixed(1)})`);

  // Juice kill
  if (!juice.pass)
    failures.push(juice.note || "juice too high");

  // Market contradiction
  if (lineSignal === "contra")
    failures.push("closing line moves against pick");

  // Minimum edge
  if (trueEdgePct < MIN_TRUE_EDGE * 100)
    failures.push(`true edge ${trueEdgePct.toFixed(1)}% < ${MIN_TRUE_EDGE * 100}%`);

  // Signal-to-noise: edge must exceed model uncertainty
  // If uncertainty is ±12% and edge is 8%, the edge is indistinguishable from noise
  if (trueEdgePct / 100 < uncertainty)
    failures.push(`edge (${trueEdgePct.toFixed(1)}%) < model uncertainty (±${(uncertainty*100).toFixed(0)}%) — noise, not signal`);

  return failures;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function applyFilterLayer(pick, game, mlb, modelProb) {
  const pickIsHome = pick === game.homeTeam;

  const homeP = pitcherFlags(mlb?.homePitcher);
  const awayP = pitcherFlags(mlb?.awayPitcher);

  const allFlags = [
    ...homeP.flags.map(f => `HOME_SP_${f}`),
    ...awayP.flags.map(f => `AWAY_SP_${f}`),
  ];

  const parkAdj   = getParkFactor(game.homeTeam);
  const pVariance = parkVariance(game.homeTeam);
  const variance  = mergeVariance(homeP.variance, awayP.variance, pVariance);

  const shrinkFactor   = variance === "HIGH" ? 0.75 : variance === "MED" ? 0.90 : 1.0;
  const pickModelProb  = pickIsHome ? modelProb : (1 - modelProb);
  const trueWinProb    = 0.5 + (pickModelProb - 0.5) * shrinkFactor;
  const sharpImpliedP  = sharpImplied(pick, game);
  const trueEdgeFrac   = trueWinProb - sharpImpliedP;
  const trueEdgePct    = trueEdgeFrac * 100;

  const juice       = juiceCheck(pickIsHome, game);
  const lineSignal  = closingLineSignal(pickIsHome, game);
  if (lineSignal.signal === "contra") allFlags.push("LINE_CONTRA");

  const { score: confidence, reasons: confidenceReasons } = computeConfidence({
    homeP, awayP, pickIsHome, variance, mlb, lineSignal: lineSignal.signal, trueEdgePct,
  });

  const uncertainty = getModelUncertainty(game, mlb);

  const failures = andGate({
    confidence, variance, homeP, awayP, pickIsHome, mlb,
    lineSignal: lineSignal.signal, juice, game, trueEdgePct, uncertainty,
  });

  // Verdict: only CLEAN if zero failures. Everything else is PASS.
  // No SOFT category — sharp mindset means you either have a bet or you don't.
  let verdict;
  if (failures.length === 0) {
    verdict = "CLEAN";
  } else if (trueEdgeFrac < 0) {
    verdict = "TRAP";
  } else {
    verdict = "PASS";
  }

  return {
    verdict,
    confidence:       parseFloat(confidence.toFixed(1)),
    confidenceOf:     10,
    trueEdgePct:      parseFloat(trueEdgePct.toFixed(2)),
    trueWinProbPct:   parseFloat((trueWinProb * 100).toFixed(1)),
    sharpImpliedPct:  parseFloat((sharpImpliedP * 100).toFixed(1)),
    variance,
    flags:            allFlags,
    failures,         // why this pick failed the AND-gate
    confidenceReasons,
    parkFactor:       parkAdj,
    juiceNote:        juice.note,
    lineSignal:       lineSignal.signal,
    lineNote:         lineSignal.note ?? null,
    homePitcherScore: parseFloat(homeP.score.toFixed(3)),
    awayPitcherScore: parseFloat(awayP.score.toFixed(3)),
    isSquareLine:     game.source === "sportsdata" || !game.source,
    uncertaintyPct:   parseFloat((uncertainty * 100).toFixed(1)),
    snr:              parseFloat((trueEdgePct / (uncertainty * 100)).toFixed(2)),
  };
}

export function buildParlayCards(picks) {
  // Only CLEAN picks are parlay-eligible. No mixing with SOFT.
  const clean = picks.filter(p => p.filter?.verdict === "CLEAN");

  return {
    safeCard:       clean.slice(0, 2),   // max 2 legs, highest confidence only
    balancedCard:   clean.slice(0, 3),
    aggressiveCard: clean.slice(0, 4),
  };
}
