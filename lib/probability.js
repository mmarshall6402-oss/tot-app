import { readFileSync } from "fs";
import { join } from "path";
import { parkWinAdj, getParkFactor, getHrFactor } from "./park-factors.js";

// ─── Elo prior (capped at 5% contribution per spec) ──────────────────────────

const HOME_ADVANTAGE = 35;

let _eloRatings = null;
function loadElo() {
  if (_eloRatings) return _eloRatings;
  try { _eloRatings = JSON.parse(readFileSync(join(process.cwd(), "data/elo_ratings.json"), "utf8")); }
  catch { _eloRatings = {}; }
  return _eloRatings;
}

// Called by API routes after fetching live ELO from Supabase.
// Replaces the static-file cache for the lifetime of the process/request.
export function setEloRatings(ratings) {
  _eloRatings = ratings;
}

function eloProb(homeTeam, awayTeam) {
  const r = loadElo();
  const h = r[homeTeam] || 1500;
  const a = r[awayTeam] || 1500;
  return 1 / (1 + Math.pow(10, (a - h - HOME_ADVANTAGE) / 400));
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function norm(value, min, max) {
  return clamp((value - (min + max) / 2) / ((max - min) / 2), -1, 1);
}

// ─── ERA stabilisation by sample size ────────────────────────────────────────

const LEAGUE_ERA  = 4.20;
const LEAGUE_WHIP = 1.28;
const LEAGUE_XFIP = 3.85;
const LEAGUE_KBB  = 8.5;   // league avg K-BB% ~8–9%
const LEAGUE_HH   = 35.5;  // league avg hard-hit% ~35%

// parseFloat + ?? null silently passes NaN (NaN is not nullish).
// This helper converts NaN → null so missing stats don't corrupt calculations.
function toNum(x) { const v = parseFloat(x); return isNaN(v) ? null : v; }

export function parseIP(raw) {
  if (!raw) return null;
  const [w, p = "0"] = String(raw).split(".");
  return parseInt(w, 10) + parseInt(p, 10) / 3;
}

function stabilize(value, mean, ip) {
  if (value == null) return mean;
  if (ip == null) return value;
  const trust = Math.min(1, ip / 90);  // full trust at 90 IP
  return mean * (1 - trust) + value * trust;
}

// ─── Pitcher quality score [-1, 1] ────────────────────────────────────────────
// Priority order: xFIP > K-BB% > ERA (xFIP removes park/BABIP noise)
//
// Range midpoints are set to actual league averages so a league-average pitcher
// scores 0, not slightly negative due to an off-centre range.
// ERA range [2.20, 6.20] → midpoint 4.20 = LEAGUE_ERA  ✓
// xFIP range [1.85, 5.85] → midpoint 3.85 = LEAGUE_XFIP ✓
// WHIP range [0.84, 1.72] → midpoint 1.28 = LEAGUE_WHIP  ✓

function pitcherScoreFromStats(era, xfip, whip, kbb, hh, ip) {
  const sEra  = stabilize(era,  LEAGUE_ERA,  ip);
  const sXfip = stabilize(xfip, LEAGUE_XFIP, ip);
  const sWhip = stabilize(whip, LEAGUE_WHIP, ip);
  const sKbb  = stabilize(kbb,  LEAGUE_KBB,  ip);
  const sHh   = stabilize(hh,   LEAGUE_HH,   ip);

  // xFIP has its own range centred on LEAGUE_XFIP = 3.85; ERA uses [2.20, 6.20]
  const eraNorm  = xfip != null
    ? norm(sXfip, 1.85, 5.85) * -1   // xFIP range [1.85, 5.85] midpoint = 3.85
    : norm(sEra,  2.20, 6.20) * -1;  // ERA: lower is better
  const whipNorm = norm(sWhip, 0.84, 1.72) * -1;        // WHIP: lower is better
  const kbbNorm  = norm(sKbb, 2.0, 15.0);
  const hhNorm   = norm(sHh,  26.0, 45.0) * -1;         // hard-hit%: lower is better

  if (hh != null) return eraNorm * 0.35 + kbbNorm * 0.30 + whipNorm * 0.20 + hhNorm * 0.15;
  return eraNorm * 0.40 + kbbNorm * 0.35 + whipNorm * 0.25;
}

function pitcherScore(pitcher) {
  if (!pitcher) return 0;
  const ip = parseIP(pitcher.inningsPitched);

  const seasonScore = pitcherScoreFromStats(
    toNum(pitcher.era),
    toNum(pitcher.xFip),
    toNum(pitcher.whip),
    toNum(pitcher.kBBPct),
    toNum(pitcher.hardHitPct),
    ip
  );

  // Blend in recent starts (last 5) when available — more predictive than season avg alone
  const r = pitcher.recentStarts;
  if (r && r.numStarts >= 2 && r.ip >= 6) {
    const recentScore = pitcherScoreFromStats(
      r.era, null, r.whip, r.kBBPct, null, r.ip
    );
    // 40% season (stability/regression) + 60% recent (current form)
    return seasonScore * 0.40 + recentScore * 0.60;
  }

  return seasonScore;
}

// ─── Bullpen quality ──────────────────────────────────────────────────────────

function bullpenScore(bullpen) {
  if (!bullpen) return 0;
  const era  = toNum(bullpen.era);
  const whip = toNum(bullpen.whip);
  const k9   = toNum(bullpen.k9);
  const weight = bullpen.isRolling ? 1.1 : 1.0;
  const eraNorm  = era  != null ? norm(era,  2.5, 6.5) * -1 : 0;
  const whipNorm = whip != null ? norm(whip, 1.0, 1.9) * -1 : 0;
  const k9Norm   = k9   != null ? norm(k9,   5.0, 12.0)     : 0;
  const base = (eraNorm * 0.45 + whipNorm * 0.35 + k9Norm * 0.20) * weight;

  // Fatigue penalty: 3-day ERA inflating vs 14-day baseline = key relievers overworked.
  // Cap at -0.20 to avoid double-penalising when bullpen ERA is already high.
  if (bullpen.fatigued && bullpen.eraInflation > 0) {
    return base - Math.min(0.20, bullpen.eraInflation * 0.08);
  }
  return base;
}

// ─── Lineup quality from Baseball Savant ──────────────────────────────────────
// Season wOBA when lineups are posted. League avg wOBA ≈ .320, range .285–.360.

function lineupSavantScore(savant) {
  if (!savant?.avgWoba) return 0;
  return norm(savant.avgWoba, 0.295, 0.355);
}

// ─── Recent form (10-game OPS) ────────────────────────────────────────────────

function formScore(form) {
  if (!form) return 0;
  const ops = parseFloat(form.ops) ?? null;
  return ops != null ? norm(ops, 0.620, 0.820) : 0;
}

// ─── Lineup vs pitcher handedness ─────────────────────────────────────────────
// lineupOps = team OPS against pitcher's throwing hand (L/R split)
// Uses team aggregate splits; individual lineup data when confirmed lineups post

function lineupHandednessScore(lineupOps) {
  if (!lineupOps) return 0;
  // League avg OPS vs L ~.730, vs R ~.750 (teams vary ±.050)
  return norm(lineupOps, 0.650, 0.820);
}

// ─── Standings ────────────────────────────────────────────────────────────────

function standingsScore(standings) {
  if (!standings) return 0;
  return norm(standings.winningPercentage ?? 0.500, 0.350, 0.650);
}

// ─── Model uncertainty estimate ───────────────────────────────────────────────
// Returns ± uncertainty on the probability estimate (0.0 to 0.25).
// Edge is only actionable when edge > uncertainty (signal-to-noise > 1).
//
// Sources of uncertainty (additive):
//   - No MLB data available                   +0.08  (Elo-only is weak signal)
//   - SP small sample (<35 IP), pick side     +0.05  (ERA/xFIP not yet stable)
//   - SP small sample (<35 IP), both sides    +0.04  (bad vs bad = chaos)
//   - ERA/xFIP gap (regression incoming)      +0.04  (which ERA do we believe?)
//   - HIGH variance park (Coors etc)          +0.06  (park overwhelms pitching)
//   - No lineup confirmation                  +0.02  (lineup quality unknown)
//   - No bullpen rolling data                 +0.02  (bullpen state unknown)
//   - No form data                            +0.02  (recent momentum unknown)
//   Reductions:
//   - Both SPs have meaningful IP (>40)       -0.03  (stable estimates)
//   - Confirmed lineup data available         -0.01
//   - Rolling bullpen (not just season avg)   -0.01

export function getModelUncertainty(game, mlb) {  // synchronous — called from filter
  let u = 0.05; // irreducible MLB uncertainty (even perfect information)

  if (!mlb) return u + 0.08; // Elo-only baseline

  const homeIP = parseIP(mlb.homePitcher?.inningsPitched);
  const awayIP = parseIP(mlb.awayPitcher?.inningsPitched);
  const MIN_IP = 35;

  // Pitcher sample size: +0.05 if either starter is small-sample, +0.04 extra when
  // both are — they partially cancel each other out so the "both" bonus is additive
  // on top of a single +0.05, not on top of two.
  const homeSmall = homeIP === null || homeIP < MIN_IP;
  const awaySmall = awayIP === null || awayIP < MIN_IP;
  if (homeSmall || awaySmall) u += 0.05;
  if (homeSmall && awaySmall) u += 0.04;

  // ERA/xFIP gap — which number do we believe?
  const homeEraXfipGap = mlb.homePitcher?.era && mlb.homePitcher?.xFip
    ? Math.abs(parseFloat(mlb.homePitcher.xFip) - parseFloat(mlb.homePitcher.era))
    : 0;
  const awayEraXfipGap = mlb.awayPitcher?.era && mlb.awayPitcher?.xFip
    ? Math.abs(parseFloat(mlb.awayPitcher.xFip) - parseFloat(mlb.awayPitcher.era))
    : 0;
  if (homeEraXfipGap > 1.0 || awayEraXfipGap > 1.0) u += 0.04;

  // Park volatility (Coors etc) — getParkFactor imported at top of module
  if (Math.abs(getParkFactor(game.homeTeam)) >= 1.0) u += 0.06; // Coors-tier

  // Missing context
  if (!mlb.homeLineupOpsVsPitcher && !mlb.awayLineupOpsVsPitcher) u += 0.02;
  if (!mlb.homeBullpen || !mlb.awayBullpen) u += 0.02;
  if (!mlb.homeForm && !mlb.awayForm) u += 0.02;

  // Bullpen fatigue — ERA inflating in last 3 days adds outcome uncertainty
  if (mlb.homeBullpen?.fatigued || mlb.awayBullpen?.fatigued) u += 0.02;

  // Reductions for good data
  if (homeIP !== null && homeIP >= 40 && awayIP !== null && awayIP >= 40) u -= 0.03;
  if (mlb.homeLineupOpsVsPitcher && mlb.awayLineupOpsVsPitcher) u -= 0.01;
  if (mlb.homeBullpen?.isRolling && mlb.awayBullpen?.isRolling) u -= 0.01;
  // Confirmed lineup with Savant data reduces uncertainty (we know who's batting)
  if (mlb.homeLineupSavant && mlb.awayLineupSavant) u -= 0.01;

  return Math.max(0.03, Math.min(0.25, u));
}

// ─── Main probability function ────────────────────────────────────────────────
//
// Weighting — SP/bullpen/lineup are core predictive signals; form/standings are noise:
//   35% Starting pitcher quality (xFIP > K-BB% > ERA, hard-hit if available)
//   25% Lineup quality vs pitcher handedness + Savant wOBA
//   25% Bullpen (rolling 14d preferred — relievers pitch ~40% of outs)
//   11% Elo (team baseline strength; absorbs standings — season W% is long-run Elo)
//    5% Park factor (run environment, HR inflation)
//    4% Recent 10-game form (noise indicator, deliberately capped)
//    0% Season standings (folded into Elo; omitted to prevent double-counting W%)

export function getModelProbability(game, mlb) {
  const eloPrior = eloProb(game.homeTeam, game.awayTeam);

  if (!mlb) {
    const eloAdj = (eloPrior - 0.5) * 0.11;
    return clamp(0.5 + eloAdj + parkWinAdj(game.homeTeam), 0.15, 0.85);
  }

  // 35% — Starting pitcher: xFIP primary, K-BB% secondary, ERA tertiary.
  // Soft saturation via tanh: small diffs remain linear; large diffs flatten smoothly.
  // tanh asymptotes at ±0.8 so extreme ace-vs-replacement matchups don't override everything.
  // Hard clamps are brittle (discontinuous derivative); tanh is market-realistic.
  const homePScore = pitcherScore(mlb.homePitcher);
  const awayPScore = pitcherScore(mlb.awayPitcher);
  const pitcherAdj = (() => {
    const raw = (homePScore - awayPScore) * 0.175;
    return Math.sign(raw) * Math.tanh(Math.abs(raw) / 0.8) * 0.8;
  })();

  // 25% — Lineup vs pitcher handedness + Savant quality blend.
  // Correlation note: lineup OPS and recent form share a run-scoring driver.
  // Form weight is reduced to prevent double-counting this signal.
  const homeLineup = lineupHandednessScore(mlb.homeLineupOpsVsPitcher);
  const awayLineup = lineupHandednessScore(mlb.awayLineupOpsVsPitcher);
  const homeSavant = lineupSavantScore(mlb.homeLineupSavant);
  const awaySavant = lineupSavantScore(mlb.awayLineupSavant);
  const hasSavant  = mlb.homeLineupSavant && mlb.awayLineupSavant;
  const homeLineupBlend = hasSavant ? homeLineup * 0.75 + homeSavant * 0.25 : homeLineup;
  const awayLineupBlend = hasSavant ? awayLineup * 0.75 + awaySavant * 0.25 : awayLineup;
  const lineupAdj  = (homeLineupBlend - awayLineupBlend) * 0.125;

  // 25% — Bullpen: relievers pitch ~40% of outs; equal weight to starter is correct.
  const homeBull = bullpenScore(mlb.homeBullpen);
  const awayBull = bullpenScore(mlb.awayBullpen);
  const bullAdj  = (homeBull - awayBull) * 0.125;

  // 4% — Recent form: deliberately capped. 10-game OPS swings ±.060 on variance alone;
  // any team can go 8-2 in a 10-game stretch regardless of true talent. Noise indicator.
  const homeForm10 = formScore(mlb.homeForm);
  const awayForm10 = formScore(mlb.awayForm);
  const homeForm7  = mlb.homeForm7d ? formScore(mlb.homeForm7d) : homeForm10;
  const awayForm7  = mlb.awayForm7d ? formScore(mlb.awayForm7d) : awayForm10;
  const homeFormBlend = homeForm10 * 0.70 + homeForm7 * 0.30;
  const awayFormBlend = awayForm10 * 0.70 + awayForm7 * 0.30;
  const formAdj  = (homeFormBlend - awayFormBlend) * 0.022;

  // 5% — Park factor (run environment)
  const parkAdj = parkWinAdj(game.homeTeam);
  const avgHrFactor = getHrFactor(game.homeTeam);
  const hrAdj = (avgHrFactor - 1.0) * 0.012;

  // 11% — Elo: team baseline strength absorbs the standings signal.
  // Season W% is the long-run observed version of Elo; keeping both double-counts it.
  const eloAdj = (eloPrior - 0.5) * 0.11;

  const total = 0.5 + pitcherAdj + lineupAdj + bullAdj + formAdj + parkAdj + hrAdj + eloAdj;
  return clamp(total, 0.15, 0.85);
}
