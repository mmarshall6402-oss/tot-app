/**
 * lib/prop-probability.js
 *
 * Poisson-based projections for MLB player prop picks (pitcher strikeouts,
 * batter anytime home run), blended toward the sportsbook's own price the
 * same way lib/filter.js shrinks the moneyline model toward the sharp
 * market — this module intentionally does not port filter.js's full AND-gate,
 * just that one instinct: the market knows things the model doesn't.
 *
 * Deliberately simple for v1: no bullpen-takeover modeling for strikeouts
 * (assumes the whole line reflects the starter's own expected outs), no
 * batted-ball-quality inputs for home runs beyond season HR rate + park.
 */

import { removeVig, decimalToImplied, americanToDecimal } from "./edge.js";
import { getHrFactor } from "./park-factors.js";

// League-average strikeout rate per batter faced (~2024-2025 MLB). Used as the
// opponent-matchup baseline when a team-specific K rate isn't supplied — this
// module doesn't fetch opponent lineup K% itself (out of v1 scope), so callers
// that have it should pass it in; otherwise the matchup factor is neutral (1.0).
const LEAGUE_K_PCT = 0.225;

// League-average HR per 9 IP allowed — used as the pitcher power-suppression
// baseline when a pitcher's own hr9 is unavailable (thin sample / TBD).
const LEAGUE_HR9 = 1.25;

// Expected plate appearances by batting-order slot (1st batter sees the most
// PAs per game, 9th the fewest) — standard modern lineup-construction averages.
const PA_BY_ORDER = [4.6, 4.5, 4.4, 4.3, 4.2, 4.15, 4.1, 4.0, 3.9];

// How much the raw model projection is allowed to move the market-implied
// probability. Low on purpose — the sportsbook price already encodes far more
// signal (weather, bullpen usage plans, injury news) than this model sees.
const MODEL_MARKET_BLEND = 0.25;

const MIN_PITCHER_IP = 20;
const MIN_BATTER_PA = 75;

function parseIP(raw) {
  if (raw == null) return 0;
  const [w, p = "0"] = String(raw).split(".");
  return parseInt(w, 10) + parseInt(p, 10) / 3;
}

function poissonPmf(k, lambda) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logP = -lambda + k * Math.log(lambda);
  for (let i = 2; i <= k; i++) logP -= Math.log(i);
  return Math.exp(logP);
}

function poissonCdf(k, lambda) {
  let sum = 0;
  for (let i = 0; i <= k; i++) sum += poissonPmf(i, lambda);
  return sum;
}

function marketProbFromOdds(sideAOdds, sideBOdds) {
  if (sideAOdds == null || sideBOdds == null) return null;
  const a = decimalToImplied(americanToDecimal(sideAOdds));
  const b = decimalToImplied(americanToDecimal(sideBOdds));
  const { fairHome } = removeVig(a, b);
  return fairHome; // probability of "sideA" (Over / Yes)
}

/**
 * Projects a pitcher's strikeout total against a sportsbook line.
 * @param {object} pitcher - a game's homePitcher/awayPitcher object from /api/mlb
 *   (needs inningsPitched, gamesStarted, strikeoutsPer9/kPerBF, recentStarts)
 * @param {number|null} oppTeamKPct - opposing team's strikeout rate (0-1); null = league avg
 * @param {number} line - sportsbook strikeout line (always X.5)
 * @param {number} overOdds, underOdds - American odds for Over/Under
 */
export function projectPitcherKs({ pitcher, oppTeamKPct, line, overOdds, underOdds }) {
  if (!pitcher || line == null || overOdds == null || underOdds == null) return null;

  const seasonIp = parseIP(pitcher.inningsPitched);
  const recent = pitcher.recentStarts;
  const hasRecent = recent && recent.numStarts >= 2 && recent.ip >= 6;
  if (seasonIp < MIN_PITCHER_IP && !hasRecent) return null;

  const seasonIpPerStart = pitcher.gamesStarted > 0 ? seasonIp / pitcher.gamesStarted : seasonIp;
  const expectedIp = hasRecent
    ? seasonIpPerStart * 0.40 + recent.avgIpPerStart * 0.60
    : seasonIpPerStart;
  if (!expectedIp || expectedIp <= 0) return null;

  const seasonK9 = pitcher.strikeoutsPer9 ?? (pitcher.kPerBF != null ? pitcher.kPerBF * 38.5 : null); // ~38.5 BF/9IP
  const recentK9 = hasRecent && recent.kPerBF != null ? recent.kPerBF * 38.5 : null;
  const expectedK9 = recentK9 != null && seasonK9 != null
    ? seasonK9 * 0.40 + recentK9 * 0.60
    : recentK9 ?? seasonK9;
  if (!expectedK9) return null;

  const matchupFactor = (oppTeamKPct ?? LEAGUE_K_PCT) / LEAGUE_K_PCT;
  const lambda = expectedIp * (expectedK9 / 9) * matchupFactor;

  const rawOverProb = 1 - poissonCdf(Math.floor(line), lambda);
  const marketProb = marketProbFromOdds(overOdds, underOdds);
  if (marketProb == null) return null;

  const modelProb = marketProb + (rawOverProb - marketProb) * MODEL_MARKET_BLEND;
  // Edge/confidence are relative to whichever side is actually picked — a 35%
  // Over probability is a 65%-confidence Under pick, not a 35%-confidence one.
  const higherPicked = modelProb >= 0.5;
  const pickProb = higherPicked ? modelProb : 1 - modelProb;
  const pickMarketProb = higherPicked ? marketProb : 1 - marketProb;
  const edgePct = (pickProb - pickMarketProb) * 100;

  return {
    marketType: "pitcher_k",
    player: pitcher.name,
    line,
    pick: higherPicked ? "higher" : "lower",
    odds: higherPicked ? overOdds : underOdds,
    lambda: parseFloat(lambda.toFixed(2)),
    modelProb: parseFloat(pickProb.toFixed(4)),
    marketProb: parseFloat(pickMarketProb.toFixed(4)),
    edgePct: parseFloat(edgePct.toFixed(2)),
    confidencePct: Math.round(pickProb * 100),
  };
}

/**
 * Projects the probability a batter hits at least one home run.
 * @param {object} batter - { name, hand, homeRuns, plateAppearances, battingOrder }
 * @param {object} pitcher - opposing starter (needs hr9)
 * @param {string} homeTeam - park owner, for getHrFactor()
 * @param {number} yesOdds, noOdds - American odds for Anytime HR Yes/No
 */
export function projectBatterHR({ batter, pitcher, homeTeam, yesOdds, noOdds }) {
  if (!batter || yesOdds == null || noOdds == null) return null;
  if (!batter.plateAppearances || batter.plateAppearances < MIN_BATTER_PA) return null;

  const batterRate = batter.homeRuns / batter.plateAppearances;
  const pitcherFactor = pitcher?.hr9 != null ? pitcher.hr9 / LEAGUE_HR9 : 1.0;
  const parkFactor = getHrFactor(homeTeam, batter.hand);
  const expectedPa = PA_BY_ORDER[(batter.battingOrder ?? 5) - 1] ?? 4.3;

  const lambda = batterRate * expectedPa * pitcherFactor * parkFactor;
  const rawYesProb = 1 - Math.exp(-lambda);

  const marketProb = marketProbFromOdds(yesOdds, noOdds);
  if (marketProb == null) return null;

  const modelProb = marketProb + (rawYesProb - marketProb) * MODEL_MARKET_BLEND;
  // Edge/confidence relative to the actual pick (see projectPitcherKs comment) —
  // "No" is the picked side for the vast majority of batters, since anytime-HR
  // probability is low league-wide; its confidence should read high, not low.
  const yesPicked = modelProb >= 0.5;
  const pickProb = yesPicked ? modelProb : 1 - modelProb;
  const pickMarketProb = yesPicked ? marketProb : 1 - marketProb;
  const edgePct = (pickProb - pickMarketProb) * 100;

  return {
    marketType: "batter_hr",
    player: batter.name,
    line: null,
    pick: yesPicked ? "yes" : "no",
    odds: yesPicked ? yesOdds : noOdds,
    lambda: parseFloat(lambda.toFixed(3)),
    modelProb: parseFloat(pickProb.toFixed(4)),
    marketProb: parseFloat(pickMarketProb.toFixed(4)),
    edgePct: parseFloat(edgePct.toFixed(2)),
    confidencePct: Math.round(pickProb * 100),
  };
}

// MLB boxscore stat keys behind each prop market's game log — same field
// names shown in PlayerModal's existing Game Log tab stat chips.
export const PROP_STAT_FIELD = { pitcher_k: "strikeOuts", batter_hr: "homeRuns" };

function gameLogValues(gameLog, statField) {
  return (gameLog || [])
    .map(g => g?.stat?.[statField])
    .filter(v => v != null)
    .map(Number)
    .filter(v => !Number.isNaN(v));
}

function scoreLine(values, line) {
  const total = values.length;
  const hits = values.filter(v => v >= line).length;
  const hitRatePct = total > 0 ? Math.round((hits / total) * 100) : 0;
  const lean = hitRatePct >= 55 ? "over" : hitRatePct <= 45 ? "under" : "even";
  return { line, hits, total, hitRatePct, lean };
}

/**
 * Empirical hit-rate breakdown across a range of count-stat lines (e.g. "is
 * he good for 4? 5? 6? 7?") computed directly from a player's season game
 * log — no model, just how often they've actually hit each threshold.
 * @param {Array<{stat: object}>} gameLog - lib/mlb-players.js fetchGameLog shape
 * @param {string} statField - PROP_STAT_FIELD value, e.g. "strikeOuts"
 */
export function computeHitRateBreakdown(gameLog, statField) {
  const values = gameLogValues(gameLog, statField);
  const games = values.length;
  if (games === 0) return { games: 0, avg: null, lines: [] };

  const avg = values.reduce((a, b) => a + b, 0) / games;
  const center = Math.round(avg);
  const loLine = Math.max(0, center - 2);
  const hiLine = center + 2;

  const lines = [];
  for (let line = loLine; line <= hiLine; line++) lines.push(scoreLine(values, line));

  return { games, avg: parseFloat(avg.toFixed(2)), lines };
}

/**
 * Same math as computeHitRateBreakdown but for one arbitrary line — powers
 * the Prop Lines tab's adjustable custom-line stepper (any number the user
 * types, not just the auto-generated candidate lines).
 */
export function hitRateAtLine(gameLog, statField, line) {
  const values = gameLogValues(gameLog, statField);
  if (values.length === 0 || line == null) return { line, hits: 0, total: 0, hitRatePct: 0, lean: "even" };
  return scoreLine(values, line);
}
