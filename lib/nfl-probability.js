// NFL win-probability + spread-cover model — structured like lib/probability.js (MLB),
// but built around a single shared "expected point margin" rather than separate
// probability formulas, so moneyline and spread picks always agree with each other.
//
// Win probability = P(actual margin > 0)
// Spread cover    = P(actual margin > -spreadPoints)
// Both are read off the same Normal(expectedMargin, SPREAD_SIGMA) approximation of
// NFL score-differential variance (~13.5 points, in line with widely-cited NFL margin
// std-dev estimates) — alt-line spreads just re-evaluate this at a different point.

const HOME_ADVANTAGE_ELO = 48; // Elo points; ~1.6-point spread equivalent (modern NFL HFA is small)
const SPREAD_SIGMA = 13.5;
const LEAGUE_PPG = 22.5; // rough modern-NFL points/game average, used as a neutral midpoint

let _eloRatings = {};

// Called by API routes after fetching live ELO from Supabase (nfl_team_elo table).
export function setNFLEloRatings(ratings) {
  _eloRatings = ratings || {};
}

// FiveThirtyEight-style heuristic: ~25 Elo points ≈ 1 point of NFL spread.
function eloMarginPts(homeTeam, awayTeam) {
  const h = _eloRatings[homeTeam] ?? 1500;
  const a = _eloRatings[awayTeam] ?? 1500;
  return (h + HOME_ADVANTAGE_ELO - a) / 25;
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function norm(value, min, max) {
  return clamp((value - (min + max) / 2) / ((max - min) / 2), -1, 1);
}

// Standard normal CDF (Abramowitz & Stegun 26.2.17 approximation, max error ~7.5e-8).
function normCdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp(-x * x / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

// ─── Component scores, each in [-1, 1] ────────────────────────────────────

function offenseScore(stats) {
  if (!stats) return 0;
  return norm(stats.pointsForPerGame ?? LEAGUE_PPG, 14, 31);
}

function defenseScore(stats) {
  if (!stats) return 0;
  return norm(stats.pointsAgainstPerGame ?? LEAGUE_PPG, 14, 31) * -1; // fewer allowed is better
}

function formScore(stats) {
  if (!stats || stats.last3NetDiff == null) return 0;
  return norm(stats.last3NetDiff, -14, 14);
}

// Positive when a team has more rest than a typical week (bye week, opponent off a
// short week, etc). daysRest is computed in lib/nfl-stats.js from each team's schedule.
function restScore(daysRest) {
  if (daysRest == null) return 0;
  return norm(daysRest, 4, 10);
}

// ─── Expected point margin (home - away) — the shared core of the model ──
//
// nfl: { home: <team stats from getNFLTeamStats>, away: <...> }

export function getNFLExpectedMargin(game, nfl) {
  const eloMargin = eloMarginPts(game.homeTeam, game.awayTeam);
  const home = nfl?.home;
  const away = nfl?.away;
  if (!home && !away) return eloMargin;

  const offMargin  = (offenseScore(home) - offenseScore(away)) * 7;  // points/game differential
  const defMargin  = (defenseScore(home) - defenseScore(away)) * 6;  // points-allowed differential
  const formMargin = (formScore(home) - formScore(away)) * 4;        // last-3-games momentum
  const restMargin = (restScore(home?.daysRest) - restScore(away?.daysRest)) * 2; // rest/travel

  return eloMargin + offMargin + defMargin + formMargin + restMargin;
}

export function getNFLModelProbability(game, nfl) {
  const margin = getNFLExpectedMargin(game, nfl);
  return clamp(normCdf(margin / SPREAD_SIGMA), 0.15, 0.85);
}

// spreadPoints: the home team's market spread (negative if home is favored, e.g. -3.5).
export function getNFLSpreadCoverProbability(game, nfl, spreadPoints) {
  if (spreadPoints == null) return null;
  const margin = getNFLExpectedMargin(game, nfl);
  return clamp(normCdf((margin + spreadPoints) / SPREAD_SIGMA), 0.05, 0.95);
}

// Iterates the same model across each alternate spread line The Odds API returns
// (e.g. -3.5, -7.5, -10.5) — no separate model, just re-evaluated at each point.
export function getNFLAltSpreadProbabilities(game, nfl, altLines) {
  if (!Array.isArray(altLines) || !altLines.length) return [];
  return altLines.map(point => ({ point, probability: getNFLSpreadCoverProbability(game, nfl, point) }));
}

// ─── Team totals (cheap extension — full totals model lands in Phase 2) ──
//
// Each side's expected points blends its own scoring rate with the opponent's
// points-allowed rate, regressed toward league average when data is missing.
// The home/away split intentionally uses a smaller HFA bump than the margin model
// above to avoid double-counting home-field advantage across both numbers.

function expectedPoints(off, oppDefAllowed) {
  const o = off ?? LEAGUE_PPG;
  const d = oppDefAllowed ?? LEAGUE_PPG;
  return (o + d) / 2;
}

export function getNFLExpectedTeamPoints(game, nfl) {
  const home = nfl?.home;
  const away = nfl?.away;
  const homePoints = expectedPoints(home?.pointsForPerGame, away?.pointsAgainstPerGame) + 1.0;
  const awayPoints = expectedPoints(away?.pointsForPerGame, home?.pointsAgainstPerGame) - 1.0;
  return { homePoints, awayPoints };
}

// ─── Model uncertainty estimate ───────────────────────────────────────────
// Returns ± uncertainty on the probability estimate (0.05 to 0.30) — wider floor/ceiling
// than MLB's since a 17-game season gives less in-season signal and NFL has higher
// game-to-game variance. Mirrors lib/probability.js's getModelUncertainty shape.

export function getNFLModelUncertainty(game, nfl) {
  let u = 0.04; // irreducible NFL uncertainty (even perfect information)

  if (!nfl?.home && !nfl?.away) return u + 0.10; // Elo-only baseline — weakest signal

  const home = nfl?.home;
  const away = nfl?.away;

  if (home?.pointsForPerGame == null || away?.pointsForPerGame == null) u += 0.05;
  if (home?.last3NetDiff == null || away?.last3NetDiff == null) u += 0.03;
  if (home?.daysRest == null || away?.daysRest == null) u += 0.02;

  const homeGP = (home?.wins ?? 0) + (home?.losses ?? 0) + (home?.ties ?? 0);
  const awayGP = (away?.wins ?? 0) + (away?.losses ?? 0) + (away?.ties ?? 0);
  if (homeGP < 4 || awayGP < 4) u += 0.05; // early-season small-sample noise

  return Math.max(0.05, Math.min(0.30, u));
}
