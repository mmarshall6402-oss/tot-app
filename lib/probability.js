import { readFileSync } from "fs";
import { join } from "path";
import { parkWinAdj } from "./park-factors.js";

// ─── Elo prior (capped at 10% weight per spec) ────────────────────────────────

const HOME_ADVANTAGE = 35;

let _eloRatings = null;
function loadElo() {
  if (_eloRatings) return _eloRatings;
  try {
    _eloRatings = JSON.parse(readFileSync(join(process.cwd(), "data/elo_ratings.json"), "utf8"));
  } catch { _eloRatings = {}; }
  return _eloRatings;
}

function eloProb(homeTeam, awayTeam) {
  const r = loadElo();
  const h = r[homeTeam] || 1500;
  const a = r[awayTeam] || 1500;
  return 1 / (1 + Math.pow(10, (a - h - HOME_ADVANTAGE) / 400));
}

// ─── Normalization helpers ────────────────────────────────────────────────────

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// Normalize a value to [-1, 1] given expected min/max range
function norm(value, min, max) {
  return clamp((value - (min + max) / 2) / ((max - min) / 2), -1, 1);
}

// ─── Pitcher quality score ────────────────────────────────────────────────────
// Returns a score in [-1, 1]. Positive = pitcher favors home win.
// Weights: ERA 40%, WHIP 35%, K/9 25%

function pitcherScore(pitcher) {
  if (!pitcher) return 0;
  const era  = parseFloat(pitcher.era)            ?? null;
  const whip = parseFloat(pitcher.whip)           ?? null;
  const k9   = parseFloat(pitcher.strikeoutsPer9) ?? null;

  const eraNorm  = era  !== null ? norm(era,  1.5, 7.0) * -1 : 0;
  const whipNorm = whip !== null ? norm(whip, 0.8, 2.0) * -1 : 0;
  const k9Norm   = k9   !== null ? norm(k9,   4.0, 14.0)     : 0;

  return eraNorm * 0.40 + whipNorm * 0.35 + k9Norm * 0.25;
}

// ─── Bullpen quality ──────────────────────────────────────────────────────────

function bullpenScore(bullpen) {
  if (!bullpen) return 0;
  const era  = parseFloat(bullpen.era)  ?? null;
  const whip = parseFloat(bullpen.whip) ?? null;
  const eraNorm  = era  !== null ? norm(era,  2.5, 6.0) * -1 : 0;
  const whipNorm = whip !== null ? norm(whip, 1.0, 1.8) * -1 : 0;
  return eraNorm * 0.55 + whipNorm * 0.45;
}

// ─── Recent form (last 10 games OPS) ─────────────────────────────────────────

function formScore(form) {
  if (!form) return 0;
  const ops = parseFloat(form.ops) ?? null;
  return ops !== null ? norm(ops, 0.620, 0.820) : 0;
}

// ─── Season strength (standings win%) ────────────────────────────────────────

function standingsScore(standings) {
  if (!standings) return 0;
  const winPct = standings.winningPercentage ?? 0.500;
  return norm(winPct, 0.350, 0.650);
}

// ─── Main probability function ────────────────────────────────────────────────
//
// Weighting per spec:
//   35% Pitcher quality (SP ERA/WHIP/K9 differential)
//   20% Recent form (OPS last 10)
//   15% Bullpen strength
//   15% Season standings
//   10% Park factor (via parkWinAdj)
//    5% Home field advantage (already in Elo prior)
//   Max 10% Elo prior contribution
//
// Missing lineup data (15% in spec) redistributed to form + pitcher.

export function getModelProbability(game, mlb) {
  // 1. Elo prior — capped contribution
  const eloPrior = eloProb(game.homeTeam, game.awayTeam);

  if (!mlb) {
    // No live data — use Elo only, but cap its pull
    const eloAdj = (eloPrior - 0.5) * 0.10;  // max ±5% from Elo
    return clamp(0.5 + eloAdj + parkWinAdj(game.homeTeam), 0.15, 0.85);
  }

  // 2. Pitcher differential (35%)
  const homePScore = pitcherScore(mlb.homePitcher);
  const awayPScore = pitcherScore(mlb.awayPitcher);
  const pitcherAdj = (homePScore - awayPScore) * 0.175;  // ±0.175 max contribution

  // 3. Recent form (20%)
  const homeForm = formScore(mlb.homeForm);
  const awayForm = formScore(mlb.awayForm);
  const formAdj  = (homeForm - awayForm) * 0.10;

  // 4. Bullpen (15%)
  const homeBull = bullpenScore(mlb.homeBullpen);
  const awayBull = bullpenScore(mlb.awayBullpen);
  const bullAdj  = (homeBull - awayBull) * 0.075;

  // 5. Standings (15%)
  const homeStand = standingsScore(mlb.homeStandings);
  const awayStand = standingsScore(mlb.awayStandings);
  const standAdj  = (homeStand - awayStand) * 0.075;

  // 6. Park factor (10%) — already directional from parkWinAdj
  const parkAdj = parkWinAdj(game.homeTeam);

  // 7. Elo contribution (max 10%)
  const eloAdj = (eloPrior - 0.5) * 0.10;

  // Sum adjustments around 0.5 baseline
  const total = 0.5 + pitcherAdj + formAdj + bullAdj + standAdj + parkAdj + eloAdj;

  return clamp(total, 0.15, 0.85);
}
