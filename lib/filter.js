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

const toNum = x => { const v = parseFloat(x); return isNaN(v) ? null : v; };

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

// ─── Signal agreement score ───────────────────────────────────────────────────
// Each independent signal votes +1 (supports pick), -1 (contradicts pick), or abstains.
// Signals: SP quality differential, bullpen ERA differential, lineup OPS differential,
// market line movement direction.
//
// ratio = sum / count  → [-1, 1]
//   ≥ +0.75 (≥3/4 agree) : strong alignment, genuine edge
//    0 to +0.5           : mixed, suppress confidence
//   ≤ -0.5               : signals conflict with pick → likely trap

function signalAgreement(pickIsHome, mlb, homeP, awayP, lineSignal) {
  const votes = [];

  // SP: is the pick-side pitcher meaningfully better?
  const pickPScore = pickIsHome ? homeP.score : awayP.score;
  const oppPScore  = pickIsHome ? awayP.score : homeP.score;
  const spDiff = pickPScore - oppPScore;
  if (Math.abs(spDiff) >= 0.15) votes.push(spDiff > 0 ? 1 : -1);

  // Bullpen: is the pick-side bullpen meaningfully better?
  const pickBullEra = toNum(pickIsHome ? mlb?.homeBullpen?.era : mlb?.awayBullpen?.era);
  const oppBullEra  = toNum(pickIsHome ? mlb?.awayBullpen?.era : mlb?.homeBullpen?.era);
  if (pickBullEra != null && oppBullEra != null && Math.abs(pickBullEra - oppBullEra) >= 0.30) {
    votes.push(pickBullEra < oppBullEra ? 1 : -1);
  }

  // Lineup: is the pick-side lineup meaningfully better vs pitcher handedness?
  const pickLineup = toNum(pickIsHome ? mlb?.homeLineupOpsVsPitcher : mlb?.awayLineupOpsVsPitcher);
  const oppLineup  = toNum(pickIsHome ? mlb?.awayLineupOpsVsPitcher : mlb?.homeLineupOpsVsPitcher);
  if (pickLineup != null && oppLineup != null && Math.abs(pickLineup - oppLineup) >= 0.020) {
    votes.push(pickLineup > oppLineup ? 1 : -1);
  } else if (pickLineup != null && Math.abs(pickLineup - 0.720) >= 0.030) {
    votes.push(pickLineup > 0.720 ? 1 : -1);
  }

  // Market: line movement direction vs pick
  if (lineSignal === "confirming") votes.push(1);
  if (lineSignal === "contra")     votes.push(-1);

  if (!votes.length) return { sum: 0, count: 0, ratio: 0, normalized: null, label: "no data" };
  const sum        = votes.reduce((a, b) => a + b, 0);
  const ratio      = sum / votes.length;
  const normalized = (sum + votes.length) / (2 * votes.length); // 0→1; 0.5 = split, 1.0 = all agree
  const label = ratio >= 0.75 ? "aligned" : ratio >= 0.25 ? "leaning" : ratio >= -0.25 ? "split" : ratio >= -0.75 ? "conflicted" : "opposed";
  return { sum, count: votes.length, ratio: parseFloat(ratio.toFixed(2)), normalized: parseFloat(normalized.toFixed(3)), label };
}

// ─── Confidence score (0–10) ──────────────────────────────────────────────────
// Additive. Starts at 4.5. Adjustments are grouped into four capped categories
// to prevent correlated signals from stacking into a single penalty.
//
// Category caps prevent triple-punishing one root issue (e.g. a bad pitcher
// profile triggering small sample + HIGH_ERA + ERA_XFIP_GAP + variance all at once).
//
// Calibration targets (post-cap):
//   LOW variance, SP+bullpen+lineup aligned:  ~7.5–9.0 (CLEAN)
//   LOW variance, SP+bullpen only:            ~6.5–7.5 (BET/CLEAN)
//   LOW variance, avg data:                   ~5.5–6.5 (borderline BET)
//   MED variance, avg data:                   ~4.5–5.5 (usually PASS)
//   HIGH variance:                            ~2.5–4.0 (always PASS — AND-gate blocks)

const CONF_CAPS = {
  variance: { min: -2.5, max:  1.0 },
  pitching: { min: -3.0, max:  2.0 },  // unified: SP × 0.7 + bullpen × 0.3, then capped
  lineup:   { min: -1.0, max:  1.0 },
  market:   { min: -2.0, max:  1.0 },
  // agreement and form/standings are uncapped:
  //   agreement is already a single composite signal [-2.5, +0.4]
  //   form/standings max magnitude is ±0.9 — informational nudge only
};

const clampAdj = (v, cat) => Math.max(CONF_CAPS[cat].min, Math.min(CONF_CAPS[cat].max, v));

// Normalized bullpen quality score [-1, +1], parallel to pitcherFlags.score.
// ERA centered at 3.80 (MLB avg), scale 1.20; WHIP centered at 1.25, scale 0.35.
// Fatigue and opponent elite pen are additive modifiers before final clamp.
function computeBullpenScore(bull, oppBull) {
  if (!bull) return 0;
  const era  = toNum(bull.era);
  const whip = toNum(bull.whip);
  let s = 0;
  if (era  != null) s += Math.max(-1, Math.min(1, (3.80 - era)  / 1.20)) * 0.65;
  if (whip != null) s += Math.max(-1, Math.min(1, (1.25 - whip) / 0.35)) * 0.25;
  if (bull.isRolling && era != null && era < 3.50) s += 0.15;
  if (bull.fatigued) s -= 0.25;
  if (oppBull?.isRolling) {
    const oppEra = toNum(oppBull.era);
    if (oppEra != null && oppEra < 3.50) s -= 0.15;
  }
  return Math.max(-1, Math.min(1, s));
}

function computeConfidence({
  homeP, awayP,
  pickIsHome,
  variance,
  mlb,
  lineSignal,
  trueEdgePct,
  agreement,
}) {
  const pickedP = pickIsHome ? homeP : awayP;
  const reasons = [];

  // ── Variance ──────────────────────────────────────────────────────────────
  let vAdj = 0;
  if (variance === "LOW")  { vAdj += 1.0;  reasons.push("+1 low variance"); }
  if (variance === "MED")  { vAdj -= 0.3;  reasons.push("-0.3 med variance"); }
  if (variance === "HIGH") { vAdj -= 2.0;  reasons.push("-2 high variance"); }
  const vCapped = clampAdj(vAdj, "variance");
  if (vCapped !== vAdj) reasons.push(`[variance cap: ${vAdj.toFixed(1)} → ${vCapped.toFixed(1)}]`);

  // ── Signal agreement (uncapped — single composite, already bounded) ────────
  let agAdj = 0;
  if (agreement.normalized != null) {
    if (agreement.normalized < 0.4)       { agAdj -= 2.5; reasons.push(`-2.5 signals mostly oppose pick (${agreement.normalized.toFixed(2)})`); }
    else if (agreement.normalized < 0.5)  { agAdj -= 1.5; reasons.push(`-1.5 signals lean against pick (${agreement.normalized.toFixed(2)})`); }
    else if (agreement.normalized < 0.6)  { agAdj -= 0.8; reasons.push(`-0.8 signals split (${agreement.normalized.toFixed(2)}, ${agreement.sum}/${agreement.count})`); }
    else if (agreement.normalized >= 0.75){ agAdj += 0.4; reasons.push(`+0.4 signals well aligned (${agreement.normalized.toFixed(2)}, ${agreement.sum}/${agreement.count})`); }
  }

  // ── Pitching (unified: SP × 0.7 + bullpen × 0.3, then cap) ──────────────
  const bull    = pickIsHome ? mlb?.homeBullpen : mlb?.awayBullpen;
  const oppBull = pickIsHome ? mlb?.awayBullpen : mlb?.homeBullpen;
  const pickIP  = parseIP(mlb?.[pickIsHome ? "homePitcher" : "awayPitcher"]?.inningsPitched);
  const oppIP   = parseIP(mlb?.[pickIsHome ? "awayPitcher" : "homePitcher"]?.inningsPitched);

  const bScore      = computeBullpenScore(bull, oppBull);
  const pitchingCore = pickedP.score * 0.7 + bScore * 0.3;
  reasons.push(`pitching core: SP(${pickedP.score.toFixed(2)})×0.7 + bull(${bScore.toFixed(2)})×0.3 = ${pitchingCore.toFixed(2)}`);

  // Scale pitchingCore [-1,+1] → confidence space (asymmetric: -1→-2.5, +1→+1.8)
  let pAdj = pitchingCore >= 0 ? pitchingCore * 1.8 : pitchingCore * 2.5;

  // Sample size penalties — binary categorical, not captured in quality scores
  if (pickIP !== null && pickIP >= MIN_IP_MEANINGFUL) { pAdj += 0.4;  reasons.push("+0.4 meaningful SP sample"); }
  if (pickIP !== null && pickIP < MIN_IP_BET)         { pAdj -= 2.0;  reasons.push("-2.0 SP tiny sample (<12 IP)"); }
  else if (pickIP !== null && pickIP < MIN_IP_MEANINGFUL) { pAdj -= 1.2; reasons.push("-1.2 SP small sample"); }
  if (oppIP !== null && oppIP < MIN_IP_BET)  { pAdj -= 0.6; reasons.push("-0.6 opp SP tiny sample"); }
  else if (oppIP !== null && oppIP < 20)     { pAdj -= 0.3; reasons.push("-0.3 opp SP small sample"); }

  // SP diagnostic flags (categorical risk signals on top of quality score)
  if (pickedP.flags.includes("ERA_XFIP_GAP"))      { pAdj -= 0.8; reasons.push("-0.8 ERA beats xFIP (regression risk)"); }
  if (pickedP.flags.includes("ERA_WHIP_MISMATCH")) { pAdj -= 0.4; reasons.push("-0.4 ERA/WHIP mismatch"); }
  if (pickedP.flags.includes("HIGH_ERA"))          { pAdj -= 0.8; reasons.push("-0.8 high ERA"); }

  const pCapped = clampAdj(pAdj, "pitching");
  if (pCapped !== pAdj) reasons.push(`[pitching cap: ${pAdj.toFixed(1)} → ${pCapped.toFixed(1)}]`);

  // ── Lineup ────────────────────────────────────────────────────────────────
  let lAdj = 0;
  const lineupOps = pickIsHome ? mlb?.homeLineupOpsVsPitcher : mlb?.awayLineupOpsVsPitcher;
  if (lineupOps != null) {
    if (lineupOps >= 0.740) { lAdj += 0.3; reasons.push("+0.3 lineup advantage vs pitcher hand"); }
    if (lineupOps <= 0.680) { lAdj -= 0.5; reasons.push("-0.5 lineup disadvantaged vs pitcher hand"); }
  } else {
    lAdj -= 0.1;
    reasons.push("-0.1 lineup not yet posted");
  }

  const pickSavant = pickIsHome ? mlb?.homeLineupSavant : mlb?.awayLineupSavant;
  const oppSavant  = pickIsHome ? mlb?.awayLineupSavant : mlb?.homeLineupSavant;
  if (pickSavant?.avgWoba != null) {
    if (pickSavant.avgWoba >= 0.340) { lAdj += 0.3; reasons.push("+0.3 above-avg lineup (Savant wOBA)"); }
    if (pickSavant.avgWoba <= 0.295) { lAdj -= 0.3; reasons.push("-0.3 below-avg lineup (Savant wOBA)"); }
  }
  if (oppSavant?.avgBarrelPct != null && oppSavant.avgBarrelPct >= 9.5) {
    lAdj -= 0.3; reasons.push(`-0.3 opponent lineup elite barrel rate (${oppSavant.avgBarrelPct.toFixed(1)}%)`);
  }

  const lCapped = clampAdj(lAdj, "lineup");
  if (lCapped !== lAdj) reasons.push(`[lineup cap: ${lAdj.toFixed(1)} → ${lCapped.toFixed(1)}]`);

  // ── Market ────────────────────────────────────────────────────────────────
  let mAdj = 0;
  if (lineSignal === "confirming") { mAdj += 0.5; reasons.push("+0.5 line confirms"); }
  if (lineSignal === "contra")     { mAdj -= 1.5; reasons.push("-1.5 line contradicts"); }
  if (trueEdgePct > 7.0 && lineSignal === "contra") {
    mAdj -= 0.8; reasons.push("-0.8 model disagreement: high claimed edge + contra line movement");
  }
  if (trueEdgePct <= 2)  { mAdj -= 0.5; reasons.push("-0.5 thin true edge"); }
  if (trueEdgePct > 7.0) { mAdj -= 0.5; reasons.push("-0.5 edge skepticism (>7% unlikely in sharp market)"); }

  const mCapped = clampAdj(mAdj, "market");
  if (mCapped !== mAdj) reasons.push(`[market cap: ${mAdj.toFixed(1)} → ${mCapped.toFixed(1)}]`);

  // ── Form / standings (uncapped — max ±0.9, informational nudge only) ──────
  let fAdj = 0;
  const pickForm   = pickIsHome ? mlb?.homeForm   : mlb?.awayForm;
  const oppForm    = pickIsHome ? mlb?.awayForm   : mlb?.homeForm;
  const pickForm7d = pickIsHome ? mlb?.homeForm7d : mlb?.awayForm7d;
  const oppForm7d  = pickIsHome ? mlb?.awayForm7d : mlb?.homeForm7d;
  if (pickForm?.ops != null) {
    if (parseFloat(pickForm.ops) >= 0.770) { fAdj += 0.1; reasons.push("+0.1 strong offensive form"); }
    if (parseFloat(pickForm.ops) <= 0.670) { fAdj -= 0.2; reasons.push("-0.2 weak offensive form"); }
  }
  if (pickForm7d?.ops != null) {
    if (parseFloat(pickForm7d.ops) >= 0.800) { fAdj += 0.1; reasons.push("+0.1 offense hot last 7 days"); }
    if (parseFloat(pickForm7d.ops) <= 0.650) { fAdj -= 0.2; reasons.push("-0.2 offense cold last 7 days"); }
  }
  if (oppForm?.ops != null && parseFloat(oppForm.ops) >= 0.780) {
    fAdj -= 0.3; reasons.push("-0.3 opponent hot offense");
  }
  if (oppForm7d?.ops != null && parseFloat(oppForm7d.ops) >= 0.810) {
    fAdj -= 0.3; reasons.push("-0.3 opponent on fire last 7 days");
  }
  const pickStandings = pickIsHome ? mlb?.homeStandings : mlb?.awayStandings;
  const pickWP = pickStandings?.winningPercentage ?? null;
  if (pickWP !== null) {
    if (pickWP <= 0.420)       { fAdj -= 0.3; reasons.push("-0.3 weak team record"); }
    else if (pickWP <= 0.460)  { fAdj -= 0.1; reasons.push("-0.1 losing record"); }
  }

  // ── Sum ───────────────────────────────────────────────────────────────────
  const score = 4.5 + vCapped + agAdj + pCapped + lCapped + mCapped + fAdj;
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
  agreement,
  dynamicMinEdge,
}) {
  const failures = [];

  if (confidence < MIN_CONFIDENCE)
    failures.push(`confidence ${confidence.toFixed(1)}/10 < ${MIN_CONFIDENCE}`);

  // HIGH variance: normally kills the pick. Exception: strong signal agreement + meaningful
  // edge + confirming market movement can keep it BET-eligible (never CLEAN).
  // Rationale: some of the best value in MLB lives in genuinely uncertain games — volatile
  // dogs, offense-vs-shaky-SP matchups. Don't auto-exclude profitable uncertainty.
  if (variance === "HIGH") {
    const highVarianceOverride = agreement.normalized != null
      && agreement.normalized > 0.80
      && trueEdgePct >= 5
      && lineSignal === "confirming";
    if (!highVarianceOverride)
      failures.push(`variance HIGH (too unpredictable)`);
  }

  const pickSide  = pickIsHome ? homeP : awayP;
  if (pickSide.flags.includes("NO_PITCHER_DATA"))
    failures.push("pick-side SP data missing");

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

  // Underdog filter — use market-implied probability, not raw odds sign.
  // Raw odds can be null or stale; sharpImpliedP < 0.50 reliably detects an underdog pick.
  const isUnderdog = sharpImpliedP != null && sharpImpliedP < 0.50;
  if (isUnderdog && confidence < 7.5)
    failures.push(`underdog pick requires confidence ≥7.5 (have ${confidence.toFixed(1)})`);

  // Juice kill
  if (!juice.pass)
    failures.push(juice.note || "juice too high");

  // Model disagreement: >7% claimed edge while sharp money flows opposite = PASS
  if (trueEdgePct > 7.0 && lineSignal === "contra")
    failures.push(`model disagreement: ${trueEdgePct.toFixed(1)}% edge claimed but line moves against pick`);

  // Minimum edge — dynamic floor based on how "obvious" the market considers this game.
  // Heavy favorites have less directional uncertainty; a smaller model-market gap is real signal.
  //   ≥ 62% implied (~-165+) → 1.5% floor
  //   ≥ 57% implied (~-133+) → 2.0% floor
  //   default               → 3.0% floor
  if (trueEdgePct < dynamicMinEdge)
    failures.push(`true edge ${trueEdgePct.toFixed(1)}% < ${dynamicMinEdge}%`);

  // Signal-to-noise — for heavy favorites, tie the SNR cap to the dynamic min edge
  // so a pick that clears the floor doesn't get double-blocked by the noise gate.
  const snrCap = dynamicMinEdge < MIN_TRUE_EDGE * 100 ? dynamicMinEdge / 100 : 0.12;
  const effectiveUncertainty = Math.min(uncertainty, snrCap);
  if (trueEdgePct / 100 < effectiveUncertainty)
    failures.push(`edge (${trueEdgePct.toFixed(1)}%) < model uncertainty (±${(effectiveUncertainty*100).toFixed(0)}%) — noise, not signal`);

  return failures;
}

// ─── Main export ──────────────────────────────────────────────────────────────
// Wrapped in try-catch: a bug in filter logic must NEVER take down the whole
// API response. One bad game returns a safe PASS; everything else still loads.

const SAFE_PASS = {
  verdict: "PASS", confidence: 0, confidenceOf: 10,
  trueEdgePct: 0, rawEdgePct: 0, variancePenalty: 0, samplePenalty: 0, lineupPenalty: 0,
  trueWinProbPct: 50, sharpImpliedPct: 50, dynamicMinEdge: 3.0,
  variance: "HIGH", flags: ["FILTER_ERROR"], failures: ["filter error — see server logs"],
  confidenceReasons: [], parkFactor: 0, juiceNote: null,
  lineSignal: "unknown", lineNote: null,
  homePitcherScore: 0, awayPitcherScore: 0,
  isSquareLine: true, uncertaintyPct: 0, snr: 0, halfSize: false,
  signalAgreement: { sum: 0, count: 0, ratio: 0, normalized: null, label: "no data" },
};

export function applyFilterLayer(pick, game, mlb, modelProb) {
  try {
    return _applyFilterLayer(pick, game, mlb, modelProb);
  } catch (e) {
    console.error("[filter] applyFilterLayer threw:", e?.message, { pick, home: game?.homeTeam, away: game?.awayTeam });
    return { ...SAFE_PASS };
  }
}

function _applyFilterLayer(pick, game, mlb, modelProb) {
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

  const pickModelProb = pickIsHome ? modelProb : (1 - modelProb);
  const sharpImpliedP = sharpImplied(pick, game);

  // No market line — can't compute a valid edge. Return PASS immediately.
  // Prevents NaN propagation: NaN < threshold is always false in JS, which
  // would let no-line games pass the AND-gate and earn a CLEAN verdict.
  if (sharpImpliedP === null) {
    return {
      verdict: "PASS", confidence: 0, confidenceOf: 10,
      trueEdgePct: 0, rawEdgePct: 0,
      variancePenalty: 0, samplePenalty: 0, lineupPenalty: 0,
      trueWinProbPct: parseFloat((pickModelProb * 100).toFixed(1)),
      sharpImpliedPct: 50,
      variance, flags: allFlags, failures: ["no market line — edge undefined"],
      confidenceReasons: [], parkFactor: parkAdj, juiceNote: null,
      lineSignal: "unknown", lineNote: null,
      homePitcherScore: parseFloat(homeP.score.toFixed(3)),
      awayPitcherScore: parseFloat(awayP.score.toFixed(3)),
      isSquareLine: true, uncertaintyPct: 0, snr: 0, halfSize: false,
    };
  }

  // Blend model probability toward market for all picks.
  // Edge = (model − market) × blend — reflects only how much the model disagrees
  // with the market, not the model's absolute distance from 50%.
  //
  //   blend: LOW=0.19, MED=0.11, HIGH=0.06
  //
  // Halved from LOW=0.38/MED=0.22/HIGH=0.12 after calibration review: CLEAN picks
  // (the games where the model pulls trueWinProb furthest from the market) were
  // landing at ~64% predicted vs ~36% actual (n=11), while picks left close to
  // market price (PASS) were well-calibrated (~55% predicted vs ~55% actual,
  // n=178). The model's own scoring signals were pulling estimates away from the
  // more-reliable market price. Shrinking the blend keeps the model's input but
  // weights the market price more heavily until recalibration is validated on a
  // larger sample.
  //
  // When pick-side SP is TBD (no pitcher data), the model has no pitching anchor so
  // its probability is less trustworthy — halve the blend.
  //
  // Examples (LOW var, known SP):
  //   model 65%, market 56% → 56 + 9×0.19 = 57.7%  → edge 1.7%
  //   model 70%, market 56% → 56 + 14×0.19 = 58.7% → edge 2.7%
  // Examples (MED var, TBD SP):
  //   model 90%, market 50% → 50 + 40×0.055 = 52.2% → rawEdge 2.2% → displayed ~0.8%
  const pickSPMissing = (pickIsHome ? homeP : awayP).flags.includes("NO_PITCHER_DATA");
  const blend         = (variance === "HIGH" ? 0.06 : variance === "MED" ? 0.11 : 0.19)
                        * (pickSPMissing ? 0.5 : 1.0);
  const trueWinProb   = sharpImpliedP + (pickModelProb - sharpImpliedP) * blend;

  // Confidence decay: reduce effective edge based on uncertainty sources.
  // AdjustedEdge = RawEdge - VariancePenalty - SamplePenalty - LineupPenalty
  const trueEdgeFrac = trueWinProb - sharpImpliedP;
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

  const agreement = signalAgreement(pickIsHome, mlb, homeP, awayP, lineSignal.signal);
  if (agreement.label === "opposed")   allFlags.push("SIGNALS_OPPOSED");
  if (agreement.label === "conflicted") allFlags.push("SIGNALS_CONFLICTED");

  const { score: confidence, reasons: confidenceReasons } = computeConfidence({
    homeP, awayP, pickIsHome, variance, mlb, lineSignal: lineSignal.signal, trueEdgePct, agreement,
  });

  const uncertainty = getModelUncertainty(game, mlb);

  // Dynamic edge floor: heavy favorites have less directional uncertainty.
  // When the market strongly agrees on direction, a smaller gap is still meaningful signal.
  const dynamicMinEdge = sharpImpliedP != null && sharpImpliedP >= 0.62 ? 1.5
                       : sharpImpliedP != null && sharpImpliedP >= 0.57 ? 2.0
                       : MIN_TRUE_EDGE * 100;

  const failures = andGate({
    confidence, variance, homeP, awayP, pickIsHome, mlb,
    lineSignal: lineSignal.signal, juice, game, trueEdgePct, uncertainty,
    trueWinProb, sharpImpliedP, agreement, dynamicMinEdge,
  });

  // CLEAN: every condition passes AND variance is not HIGH → steals eligible
  // HIGH variance picks that cleared the override can reach BET but never CLEAN.
  let verdict;
  if (failures.length === 0 && variance !== "HIGH") {
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
      f.includes("fatigued") || f.includes("barrel rate") ||
      f.includes("model disagreement")  // blocks CLEAN only, not BET
    );
    if (
      !catastrophic &&
      onlyMinorFailures &&
      trueEdgePct >= dynamicMinEdge &&
      confidence >= 6.5
    ) {
      verdict = "BET";
    } else {
      verdict = "PASS";
    }
  }

  // Hard TRAP override: if the majority of signals actively oppose the pick it's likely a trap.
  // (No hard PASS gate — the graduated confidence penalty above handles mixed signals.)
  if (agreement.normalized != null && agreement.normalized < 0.4) verdict = "TRAP";

  // Half-size flag: CLEAN but pick-side bullpen ERA > 5.00.
  // Any CLEAN pick with a struggling bullpen carries meaningful late-game variance — size down.
  const pickBullpen = pickIsHome ? mlb?.homeBullpen : mlb?.awayBullpen;
  const halfSize = verdict === "CLEAN"
    && pickBullpen?.era != null && parseFloat(pickBullpen.era) > 5.00;

  // When the signal-agreement override forces TRAP on a pick with a positive model edge,
  // cap the displayed edge at 0. The market signals invalidate the direction; showing +12%/TRAP
  // is contradictory. rawEdgePct preserves the model's original assessment for diagnostics.
  const displayEdgePct = verdict === "TRAP" ? Math.min(0, trueEdgePct) : trueEdgePct;

  return {
    verdict,
    confidence:       parseFloat(confidence.toFixed(1)),
    confidenceOf:     10,
    trueEdgePct:      parseFloat(displayEdgePct.toFixed(2)),
    rawEdgePct:       parseFloat(rawEdgePct.toFixed(2)),      // before decay
    variancePenalty:  parseFloat(variancePenalty.toFixed(2)), // decay breakdown
    samplePenalty:    parseFloat(samplePenalty.toFixed(2)),
    lineupPenalty:    parseFloat(lineupPenalty.toFixed(2)),
    trueWinProbPct:   parseFloat((trueWinProb * 100).toFixed(1)),
    sharpImpliedPct:  parseFloat((sharpImpliedP * 100).toFixed(1)),
    dynamicMinEdge:   parseFloat(dynamicMinEdge.toFixed(1)),
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
    snr:              parseFloat((displayEdgePct / (uncertainty * 100)).toFixed(2)),
    halfSize:         halfSize || false,
    signalAgreement:  agreement,  // { sum, count, ratio, label } — diagnostic
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
