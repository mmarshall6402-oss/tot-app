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
import { getModelUncertainty, parseIP } from "./probability.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const SQUARE_LINE_COMPRESSION = 0.015; // 3% was eating ~40% of a real 7% edge
const MIN_CONFIDENCE          = 6.5;   // recalibrated: +0.5 edge bonus removed, 7.0 was too tight
const MIN_IP_MEANINGFUL       = 25;    // raised: need 25 IP before ERA is meaningful
const MIN_IP_BET              = 12;    // hard floor: < 12 IP = can't trust ERA at all → auto-PASS
const MIN_TRUE_EDGE           = 0.030; // raised: 2.5% is noise; 3%+ needed for real edge

// ─── Pitcher sample size ──────────────────────────────────────────────────────

function pitcherFlags(pitcher) {
  // MED not HIGH: unknown starter is uncertain, not catastrophic — other signals still valid.
  // The AND-gate still blocks pick-side NO_PITCHER_DATA; this only affects merged variance.
  if (!pitcher) return { flags: ["NO_PITCHER_DATA"], variance: "MED", score: 0 };

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
  // NO_PITCHER_DATA alone = MED (unknown, not catastrophic — other signals still valid)
  // SMALL_SAMPLE or HIGH_ERA, or 2+ flags = HIGH
  if (flags.some(f => ["SMALL_SAMPLE","HIGH_ERA"].includes(f)) || flags.length >= 2) variance = "HIGH";
  else if (flags.length >= 1) variance = "MED";

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
  if (raw == null || isNaN(raw)) return null; // no market line available
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
// Additive. Starts at 4.5. Bonuses for genuine edges. Deductions for risk factors.
// Threshold: 6.5/10 required for both BET and CLEAN verdicts.
//
// Calibration notes (recalibrated — base lowered from 5.0):
//   LOW variance, strong signal: ~7.5–8.5 (CLEAN range — requires genuinely good data)
//   LOW variance, avg data: ~6.0–6.8 (borderline BET)
//   MED variance, avg data: ~5.0–6.0 (usually PASS)
//   HIGH variance: ~2.5–4.0 (always PASS — AND-gate blocks independently)
//
// Key design decisions:
//   - No-lineup penalty is tiny (-0.1): lineups don't post until ~3h before first pitch;
//     the cron runs at 10 AM CT so this would be a constant -0.5 tax, not a risk signal.
//     Model uncertainty already charges +0.02 for this in getModelUncertainty.
//   - MED variance: -0.3 (not -0.5). The shrinkFactor 0.80 already reduces raw edge
//     by 20% for MED variance; doubling down in confidence was over-penalizing.
//   - Standings added: model weights standings 15% but confidence ignored them entirely.

function computeConfidence({
  homeP, awayP,
  pickIsHome,
  variance,
  mlb,
  lineSignal,
  trueEdgePct,
}) {
  const pickedP  = pickIsHome ? homeP : awayP;
  let score = 4.5;  // lowered: 5.0 allowed average-good data to stack to CLEAN too easily
  const reasons = [];

  // Variance gate — MED reduced from -0.5: shrinkFactor already penalises MED in edge calc
  if (variance === "LOW") { score += 1.0; reasons.push("+1 low variance"); }
  if (variance === "MED") { score -= 0.3; reasons.push("-0.3 med variance"); }
  if (variance === "HIGH") { score -= 2.0; reasons.push("-2 high variance"); }

  // Pitcher sample size (pick side) — penalties now match the confidence decay formula
  const pickIP = parseIP(mlb?.[pickIsHome ? "homePitcher" : "awayPitcher"]?.inningsPitched);
  if (pickIP !== null && pickIP >= MIN_IP_MEANINGFUL) { score += 0.5; reasons.push("+0.5 meaningful IP"); }
  if (pickIP !== null && pickIP < MIN_IP_BET)         { score -= 2.5; reasons.push("-2.5 SP tiny sample (<12 IP)"); }
  else if (pickIP !== null && pickIP < MIN_IP_MEANINGFUL) { score -= 1.5; reasons.push("-1.5 small sample"); }

  // Opposition pitcher small sample (variance gift — be wary of chasing it)
  const oppIP = parseIP(mlb?.[pickIsHome ? "awayPitcher" : "homePitcher"]?.inningsPitched);
  if (oppIP !== null && oppIP < MIN_IP_BET) { score -= 0.8; reasons.push("-0.8 opp SP tiny sample (<12 IP)"); }
  else if (oppIP !== null && oppIP < 20)    { score -= 0.5; reasons.push("-0.5 opp SP small sample"); }

  // Pitcher quality on pick side — capped bonus: SP mismatch alone doesn't win games
  if (pickedP.score > 0.3)  { score += 0.3; reasons.push("+0.3 SP quality edge"); }
  if (pickedP.score < -0.2) { score -= 0.5; reasons.push("-0.5 SP quality deficit"); }

  // xFIP/ERA gap warning (regression incoming for pick-side pitcher)
  if (pickedP.flags.includes("ERA_XFIP_GAP")) { score -= 1.0; reasons.push("-1 ERA beats xFIP (regression risk)"); }
  if (pickedP.flags.includes("ERA_WHIP_MISMATCH")) { score -= 0.5; reasons.push("-0.5 ERA/WHIP mismatch"); }
  if (pickedP.flags.includes("HIGH_ERA")) { score -= 1.0; reasons.push("-1 high ERA"); }

  // Lineup vs handedness (meaningful signal when available)
  const lineupOps = pickIsHome ? mlb?.homeLineupOpsVsPitcher : mlb?.awayLineupOpsVsPitcher;
  if (lineupOps != null) {
    if (lineupOps >= 0.740) { score += 0.3; reasons.push("+0.3 lineup advantage vs pitcher hand"); }
    if (lineupOps <= 0.680) { score -= 0.5; reasons.push("-0.5 lineup disadvantaged vs pitcher hand"); }
  } else {
    score -= 0.1; // timing issue only — lineups post ~3h before first pitch; not a risk signal
    reasons.push("-0.1 lineup not yet posted");
  }

  // Recent offensive form (10-day) + 7-day hot streak signal
  const pickForm   = pickIsHome ? mlb?.homeForm   : mlb?.awayForm;
  const oppForm    = pickIsHome ? mlb?.awayForm   : mlb?.homeForm;
  const pickForm7d = pickIsHome ? mlb?.homeForm7d : mlb?.awayForm7d;
  const oppForm7d  = pickIsHome ? mlb?.awayForm7d : mlb?.homeForm7d;
  if (pickForm?.ops != null) {
    if (parseFloat(pickForm.ops) >= 0.760) { score += 0.2; reasons.push("+0.2 strong offensive form"); }
    if (parseFloat(pickForm.ops) <= 0.680) { score -= 0.3; reasons.push("-0.3 weak offensive form"); }
  }
  if (pickForm7d?.ops != null) {
    if (parseFloat(pickForm7d.ops) >= 0.790) { score += 0.1; reasons.push("+0.1 offense hot last 7 days"); }
    if (parseFloat(pickForm7d.ops) <= 0.660) { score -= 0.2; reasons.push("-0.2 offense cold last 7 days"); }
  }
  if (oppForm?.ops != null && parseFloat(oppForm.ops) >= 0.780) {
    score -= 0.3; reasons.push("-0.3 opponent hot offense");
  }
  if (oppForm7d?.ops != null && parseFloat(oppForm7d.ops) >= 0.810) {
    score -= 0.3; reasons.push("-0.3 opponent on fire last 7 days");
  }

  // Standings — model weights these 15% but confidence was ignoring them entirely
  const pickStandings = pickIsHome ? mlb?.homeStandings : mlb?.awayStandings;
  const pickWP = pickStandings?.winningPercentage ?? null;
  if (pickWP !== null) {
    if (pickWP >= 0.560)      { score += 0.25; reasons.push("+0.25 strong team record"); }
    else if (pickWP >= 0.530) { score += 0.1;  reasons.push("+0.1 winning record"); }
    else if (pickWP <= 0.440) { score -= 0.3;  reasons.push("-0.3 weak team record"); }
    else if (pickWP <= 0.470) { score -= 0.1;  reasons.push("-0.1 losing record"); }
  }

  // Bullpen — equally weighted with SP (relievers pitch ~40% of outs)
  const bull    = pickIsHome ? mlb?.homeBullpen : mlb?.awayBullpen;
  const oppBull = pickIsHome ? mlb?.awayBullpen : mlb?.homeBullpen;
  if (bull?.era != null) {
    if (bull.isRolling && parseFloat(bull.era) < 3.50) { score += 0.5; reasons.push("+0.5 bullpen rolling edge"); }
    else if (parseFloat(bull.era) < 3.80) { score += 0.3; reasons.push("+0.3 solid bullpen"); }
    if (parseFloat(bull.era) > 4.50) { score -= 0.5; reasons.push("-0.5 bullpen concern"); }
  }
  if (bull?.fatigued) {
    score -= 0.5;
    reasons.push(`-0.5 pick-side bullpen fatigued (ERA +${bull.eraInflation} vs 14d)`);
  }
  if (oppBull?.era != null && parseFloat(oppBull.era) < 3.50 && oppBull.isRolling) {
    score -= 0.3; reasons.push("-0.3 opponent has elite rolling bullpen");
  }

  // Lineup quality from Baseball Savant (when lineups posted)
  const pickSavant = pickIsHome ? mlb?.homeLineupSavant : mlb?.awayLineupSavant;
  const oppSavant  = pickIsHome ? mlb?.awayLineupSavant : mlb?.homeLineupSavant;
  if (pickSavant?.avgWoba != null) {
    if (pickSavant.avgWoba >= 0.340) { score += 0.3; reasons.push("+0.3 above-avg lineup (Savant wOBA)"); }
    if (pickSavant.avgWoba <= 0.295) { score -= 0.3; reasons.push("-0.3 below-avg lineup (Savant wOBA)"); }
  }
  if (oppSavant?.avgBarrelPct != null && oppSavant.avgBarrelPct >= 9.5) {
    score -= 0.3; reasons.push(`-0.3 opponent lineup elite barrel rate (${oppSavant.avgBarrelPct.toFixed(1)}%)`);
  }

  // Market movement
  if (lineSignal === "confirming") { score += 0.5; reasons.push("+0.5 line confirms"); }
  if (lineSignal === "contra")     { score -= 1.5; reasons.push("-1.5 line contradicts"); }

  // Thin edge penalty — below noise floor
  if (trueEdgePct <= 2)  { score -= 0.5; reasons.push("-0.5 thin true edge"); }
  // Large edge skepticism — MLB is a liquid market; edges >7% after decay are almost
  // certainly model noise rather than real inefficiency. Penalise, don't reward.
  if (trueEdgePct > 7.0) { score -= 0.5; reasons.push("-0.5 edge skepticism (>7% unlikely in sharp market)"); }

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
  trueWinProb,
  sharpImpliedP,
}) {
  const failures = [];

  if (confidence < MIN_CONFIDENCE)
    failures.push(`confidence ${confidence.toFixed(1)}/10 < ${MIN_CONFIDENCE}`);

  // HIGH variance kills the bet — MED is fine with everything else good
  if (variance === "HIGH")
    failures.push(`variance HIGH (too unpredictable)`);

  const pickSide  = pickIsHome ? homeP : awayP;
  if (pickSide.flags.includes("NO_PITCHER_DATA"))
    failures.push("pick-side SP data missing");

  // Regression risk on the pick-side pitcher only
  if (pickSide.flags.includes("ERA_XFIP_GAP"))
    failures.push("pick-side SP ERA beats xFIP by >1.2 (regression risk)");

  // Coors Field — permanent exclusion
  if (game.homeTeam === "Colorado Rockies")
    failures.push("Coors Field (park model cannot compensate)");

  // Hard SP sample floor — < MIN_IP_BET innings means we literally can't trust the ERA.
  // ERA over 10 games (60 IP) stabilizes; ERA over 2 starts (12 IP) is noise.
  const pickIPGate = parseIP(mlb?.[pickIsHome ? "homePitcher" : "awayPitcher"]?.inningsPitched);
  if (pickIPGate !== null && pickIPGate < MIN_IP_BET)
    failures.push(`pick-side SP < ${MIN_IP_BET} IP (${pickIPGate.toFixed(0)} IP) — ERA unreliable`);

  // Pitcher object exists but IP is missing — can't verify whether ERA is over 2 starts or 30.
  // Treat as unverifiable sample; blocks CLEAN but BET still allowed if everything else holds.
  const pickHasPitcherObj = !pickSide.flags.includes("NO_PITCHER_DATA");
  if (pickHasPitcherObj && pickIPGate === null)
    failures.push("pick-side SP innings pitched missing — IP unknown, sample size unverifiable");

  // Opponent hot offense — rolling 10-game OPS ≥ 0.800 means elevated run variance regardless
  // of how good the pick-side starter looks on paper. Caps verdict at BET, not CLEAN.
  const oppFormOps = parseFloat((pickIsHome ? mlb?.awayForm?.ops : mlb?.homeForm?.ops) ?? 0);
  if (oppFormOps >= 0.800)
    failures.push(`opponent offense running hot (OPS ${oppFormOps.toFixed(3)}) — elevated run variance`);

  // 7-day opponent form — tighter window catches squads that have heated up very recently.
  // Higher threshold (0.820) since 7-day has more variance than 10-day.
  const oppForm7dOps = parseFloat((pickIsHome ? mlb?.awayForm7d?.ops : mlb?.homeForm7d?.ops) ?? 0);
  if (oppForm7dOps >= 0.820 && oppForm7dOps > oppFormOps)
    failures.push(`opponent on fire last 7 days (OPS ${oppForm7dOps.toFixed(3)}) — recent hot lineup risk`);

  // Pick-side bullpen fatigue — ERA inflating 1.5+ points vs 14-day baseline in last 3 days.
  // Key relievers are overworked; late-game hold is uncertain. Blocks CLEAN, allows BET.
  const pickBullpenoFatigue = pickIsHome ? mlb?.homeBullpen : mlb?.awayBullpen;
  if (pickBullpenoFatigue?.fatigued)
    failures.push(`pick-side bullpen fatigued (ERA +${pickBullpenoFatigue.eraInflation} vs 14d) — late-game reliability risk`);

  // Opponent power lineup — elite barrel rate means high HR variance. Blocks CLEAN.
  const oppLineupSavant = pickIsHome ? mlb?.awayLineupSavant : mlb?.homeLineupSavant;
  if (oppLineupSavant?.avgBarrelPct != null && oppLineupSavant.avgBarrelPct >= 9.5)
    failures.push(`opponent lineup barrel rate ${oppLineupSavant.avgBarrelPct.toFixed(1)}% (elite power) — elevated HR risk`);

  // Minimum win probability floor — model must actually think pick-side wins.
  // A 49.8% win prob with LOW variance and no shrink means near-coin-flip with full trust.
  // This gate prevents CLEAN on near-even matchups where any small error flips the pick.
  if (trueWinProb < 0.515)
    failures.push(`model win prob ${(trueWinProb * 100).toFixed(1)}% < 51.5% — too close to coin flip`);

  // Underdog filter — use market-implied probability, not raw odds sign.
  // Raw odds can be null or stale; sharpImpliedP < 0.50 reliably detects an underdog pick.
  const isUnderdog = sharpImpliedP != null && sharpImpliedP < 0.50;
  if (isUnderdog && confidence < 7.5)
    failures.push(`underdog pick requires confidence ≥7.5 (have ${confidence.toFixed(1)})`);

  // Juice kill
  if (!juice.pass)
    failures.push(juice.note || "juice too high");

  // Minimum edge
  if (trueEdgePct < MIN_TRUE_EDGE * 100)
    failures.push(`true edge ${trueEdgePct.toFixed(1)}% < ${MIN_TRUE_EDGE * 100}%`);

  // Signal-to-noise — cap effective uncertainty at 12% so early-season small samples
  // don't make EVERY game fail this gate
  const effectiveUncertainty = Math.min(uncertainty, 0.12);
  if (trueEdgePct / 100 < effectiveUncertainty)
    failures.push(`edge (${trueEdgePct.toFixed(1)}%) < model uncertainty (±${(effectiveUncertainty*100).toFixed(0)}%) — noise, not signal`);

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
  // Both pitchers unknown = genuinely unpredictable; override the MED+MED case.
  const bothPitchersUnknown = homeP.flags.includes("NO_PITCHER_DATA") && awayP.flags.includes("NO_PITCHER_DATA");
  const pitcherVariance = bothPitchersUnknown ? "HIGH" : mergeVariance(homeP.variance, awayP.variance);
  const variance  = mergeVariance(pitcherVariance, pVariance);

  // Shrink factors: pull the model's win probability toward 50/50 to reflect that
  // liquid MLB markets price in most public information. Even LOW variance picks
  // shouldn't use the raw model probability — a >10% edge in a sharp market is
  // almost always model noise, not a real inefficiency.
  const shrinkFactor   = variance === "HIGH" ? 0.45 : variance === "MED" ? 0.62 : 0.78;
  const pickModelProb  = pickIsHome ? modelProb : (1 - modelProb);
  const trueWinProb    = 0.5 + (pickModelProb - 0.5) * shrinkFactor;
  const sharpImpliedP  = sharpImplied(pick, game);

  // No market line — can't compute a valid edge. Return PASS immediately.
  // Prevents NaN propagation: NaN < threshold is always false in JS, which
  // would let no-line games pass the AND-gate and earn a CLEAN verdict.
  if (sharpImpliedP === null) {
    return {
      verdict: "PASS", confidence: 0, confidenceOf: 10,
      trueEdgePct: 0, rawEdgePct: 0,
      variancePenalty: 0, samplePenalty: 0, lineupPenalty: 0,
      trueWinProbPct: parseFloat((trueWinProb * 100).toFixed(1)),
      sharpImpliedPct: 50,
      variance, flags: allFlags, failures: ["no market line — edge undefined"],
      confidenceReasons: [], parkFactor: parkAdj, juiceNote: null,
      lineSignal: "unknown", lineNote: null,
      homePitcherScore: parseFloat(homeP.score.toFixed(3)),
      awayPitcherScore: parseFloat(awayP.score.toFixed(3)),
      isSquareLine: true, uncertaintyPct: 0, snr: 0, halfSize: false,
    };
  }

  const trueEdgeFrac   = trueWinProb - sharpImpliedP;

  // Confidence decay: reduce effective edge based on uncertainty sources.
  // AdjustedEdge = RawEdge - VariancePenalty - SamplePenalty - LineupPenalty
  const pickIP = parseIP(mlb?.[pickIsHome ? "homePitcher" : "awayPitcher"]?.inningsPitched);
  const rawEdgePct = trueEdgeFrac * 100;
  const variancePenalty = variance === "HIGH" ? 1.5 : variance === "MED" ? 0.5 : 0;
  const samplePenalty   = pickIP === null ? 1.5
                        : pickIP < MIN_IP_BET ? 2.5
                        : pickIP < MIN_IP_MEANINGFUL ? 1.0
                        : 0;
  const lineupOps = pickIsHome ? mlb?.homeLineupOpsVsPitcher : mlb?.awayLineupOpsVsPitcher;
  const lineupPenalty = lineupOps == null ? 0.4 : 0;
  const decayedEdgePct  = rawEdgePct - variancePenalty - samplePenalty - lineupPenalty;
  const trueEdgePct     = decayedEdgePct;

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
    trueWinProb, sharpImpliedP,
  });

  // CLEAN: every condition passes → steals eligible
  let verdict;
  if (failures.length === 0) {
    verdict = "CLEAN";
  } else if (trueEdgeFrac < 0) {
    verdict = "TRAP";
  } else {
    // BET: must meet variance + edge + confidence bar + no catastrophic failures.
    // Previously BET ignored confidence entirely — a 5.5/10 pick could be a BET.
    // Now requires confidence >= 6.5 (below CLEAN threshold but meaningful signal).
    const catastrophic = failures.some(f =>
      f.includes("Coors") ||
      f.includes("juice") ||
      f.includes("closing line") ||
      f.includes("IP)") || // hard SP sample floor
      f.includes("SP data missing") // no pitcher data on pick side
    );
    const onlyMinorFailures = failures.every(f =>
      f.includes("confidence") || f.includes("underdog") || f.includes("uncertainty") ||
      f.includes("lineup") || f.includes("opp SP") || f.includes("edge") ||
      f.includes("running hot") || f.includes("IP unknown") ||
      f.includes("on fire") || f.includes("7 days") ||
      f.includes("fatigued") ||
      f.includes("barrel rate")
    );
    if (
      !catastrophic &&
      onlyMinorFailures &&
      variance !== "HIGH" &&
      trueEdgePct >= MIN_TRUE_EDGE * 100 &&
      confidence >= 6.5
    ) {
      verdict = "BET";
    } else {
      verdict = "PASS";
    }
  }

  // Half-size flag: CLEAN but pick-side bullpen ERA > 5.00.
  // Any CLEAN pick with a struggling bullpen carries meaningful late-game variance — size down.
  const pickBullpen = pickIsHome ? mlb?.homeBullpen : mlb?.awayBullpen;
  const halfSize = verdict === "CLEAN"
    && pickBullpen?.era != null && parseFloat(pickBullpen.era) > 5.00;

  return {
    verdict,
    confidence:       parseFloat(confidence.toFixed(1)),
    confidenceOf:     10,
    trueEdgePct:      parseFloat(trueEdgePct.toFixed(2)),
    rawEdgePct:       parseFloat(rawEdgePct.toFixed(2)),      // before decay
    variancePenalty:  parseFloat(variancePenalty.toFixed(2)), // decay breakdown
    samplePenalty:    parseFloat(samplePenalty.toFixed(2)),
    lineupPenalty:    parseFloat(lineupPenalty.toFixed(2)),
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
    halfSize:         halfSize || false,
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
