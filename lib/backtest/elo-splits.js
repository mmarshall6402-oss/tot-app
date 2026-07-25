// lib/backtest/elo-splits.js
//
// Historical, analysis-only Elo variants beyond the single flat rating
// tracked by lib/elo-db.js / lib/probability.js: Home, Away, vs LHP, vs RHP,
// a synthetic Bullpen index, and a self-contained Last-30-Days form rating.
//
// This module does NOT touch Supabase, the live team_elo table, or
// lib/probability.js's weighted formula — it only replays static historical
// data (data/games.json, retrosheet files) to produce data/elo_splits.json,
// a separate artifact for analysis/dashboarding. See
// /root/.claude/plans/hazy-purring-treehouse.md for the full design writeup.
//
// Same update formula as lib/elo-db.js#updateEloAfterGame / lib/backtest/
// elo-walkforward.js#computeWalkForwardElo (K=20, home-advantage=35),
// reimplemented here as pure in-memory math for the same reasons
// elo-walkforward.js already documents.

import { computeWalkForwardElo } from "./elo-walkforward.js";

const DEFAULT_ELO = 1500;
const DEFAULT_K = 20;
const DEFAULT_HOME_ADVANTAGE = 35;

function expected(eloA, eloB) {
  return 1 / (1 + Math.pow(10, (eloB - eloA) / 400));
}

// games: chronologically sorted [{ date, homeTeam, awayTeam, homeWon }, ...]
// Two independent tracks: a team's `home` rating only updates on games it
// played at home, compared against the opponent's `away` rating, and
// symmetrically for `away`. Each track therefore only "sees" half of every
// team's games, which is the whole point — it isolates home/away strength
// rather than blending it into one overall number.
export function computeHomeAwayElo(games, { k = DEFAULT_K, homeAdvantage = DEFAULT_HOME_ADVANTAGE, seed = DEFAULT_ELO } = {}) {
  const home = {};
  const away = {};

  for (const { homeTeam, awayTeam, homeWon } of games) {
    const homeElo = home[homeTeam] ?? seed;
    const awayElo = away[awayTeam] ?? seed;

    const expHome = expected(homeElo + homeAdvantage, awayElo);
    const actual = homeWon ? 1 : 0;

    home[homeTeam] = homeElo + k * (actual - expHome);
    away[awayTeam] = awayElo + k * ((1 - actual) - (1 - expHome));
  }

  return { home, away };
}

// starterHandByGameKey: Map<"date|homeCode|awayCode", { homeHand, awayHand }>
// (homeHand/awayHand are the OPPOSING starter's throwing hand for that side's
// batting performance — i.e. homeHand is the away starter's hand, since
// that's who the home team's lineup faced). games need homeCode/awayCode to
// look up the key alongside the usual homeTeam/awayTeam/homeWon.
//
// Each team's vsLHP/vsRHP rating only updates on games where the opposing
// starter matches that hand, compared against the OPPONENT'S contemporaneous
// overall walk-forward rating (not today's static snapshot) — using a future
// Elo value as the comparison point would leak information into a past
// game, the same no-lookahead discipline lib/backtest/season-stats.js
// applies throughout.
export function computeHandElo(games, starterHandByGameKey, { k = DEFAULT_K, homeAdvantage = DEFAULT_HOME_ADVANTAGE, seed = DEFAULT_ELO } = {}) {
  const { perGame } = computeWalkForwardElo(games, { k, homeAdvantage, seed });

  const vsLHP = {};
  const vsRHP = {};

  games.forEach((game, i) => {
    const { date, homeTeam, awayTeam, homeCode, awayCode, homeWon } = game;
    const hands = starterHandByGameKey.get(`${date}|${homeCode}|${awayCode}`);
    if (!hands) return; // no retrosheet starter data for this game — skip, don't guess

    const { preGameHomeElo, preGameAwayElo } = perGame[i];
    const actual = homeWon ? 1 : 0;

    // Home team's lineup faced the away starter (hands.homeHand); update the
    // home team's own vsHand track against the away team's overall rating.
    if (hands.homeHand === "L" || hands.homeHand === "R") {
      const bucket = hands.homeHand === "L" ? vsLHP : vsRHP;
      const rating = bucket[homeTeam] ?? seed;
      const expWin = expected(rating + homeAdvantage, preGameAwayElo);
      bucket[homeTeam] = rating + k * (actual - expWin);
    }
    // Away team's lineup faced the home starter (hands.awayHand).
    if (hands.awayHand === "L" || hands.awayHand === "R") {
      const bucket = hands.awayHand === "L" ? vsLHP : vsRHP;
      const rating = bucket[awayTeam] ?? seed;
      const expWin = expected(rating, preGameHomeElo + homeAdvantage);
      bucket[awayTeam] = rating + k * ((1 - actual) - expWin);
    }
  });

  return { vsLHP, vsRHP };
}

// Self-contained window: only games in the trailing `windowDays` of the
// dataset's latest date, all teams re-seeded at 1500. Deliberately not
// blended with full-season strength — mirrors how the live model's 14-day
// rolling bullpen window works (lib/backtest/season-stats.js
// BULLPEN_WINDOW_DAYS), just applied to the whole team instead of a subset
// of stats, and over 30 days instead of 14.
export function computeRecentFormElo(games, { windowDays = 30, k = DEFAULT_K, homeAdvantage = DEFAULT_HOME_ADVANTAGE, seed = DEFAULT_ELO } = {}) {
  if (!games.length) return {};
  const latest = games.reduce((max, g) => (g.date > max ? g.date : max), games[0].date);
  const cutoff = addDaysToYyyymmdd(latest, -windowDays);
  const windowed = games.filter(g => g.date >= cutoff && g.date <= latest);

  const { finalRatings } = computeWalkForwardElo(windowed, { k, homeAdvantage, seed });
  return finalRatings;
}

// seasonFeatures: buildSeasonFeatures() output from lib/backtest/season-stats.js
// (chronological, each entry's mlb.home/awayBullpen is the pre-game rolling
// 14-day snapshot). Takes each team's most recent non-null bullpen ERA and
// rescales it as a z-score against the cross-team distribution, mapped onto
// an Elo-like 1500-centered scale. This is explicitly NOT a real Elo — there
// is no win/loss event for a bullpen in isolation — it's a rescaled index so
// it plots on the same axis as the other six variants. Lower ERA is better,
// hence the sign flip.
export function computeBullpenEloIndex(seasonFeatures, { center = DEFAULT_ELO, scale = 100 } = {}) {
  const latestEraByTeam = new Map();

  for (const { homeTeamName, awayTeamName, mlb } of seasonFeatures) {
    if (mlb.homeBullpen?.era != null) latestEraByTeam.set(homeTeamName, mlb.homeBullpen.era);
    if (mlb.awayBullpen?.era != null) latestEraByTeam.set(awayTeamName, mlb.awayBullpen.era);
  }

  const eras = [...latestEraByTeam.values()];
  if (!eras.length) return {};
  const mean = eras.reduce((a, b) => a + b, 0) / eras.length;
  const variance = eras.reduce((a, b) => a + (b - mean) ** 2, 0) / eras.length;
  const stdDev = Math.sqrt(variance) || 1;

  const result = {};
  for (const [team, era] of latestEraByTeam) {
    const z = (era - mean) / stdDev;
    result[team] = center - z * scale; // lower ERA -> higher index
  }
  return result;
}

function addDaysToYyyymmdd(yyyymmdd, days) {
  const y = parseInt(yyyymmdd.slice(0, 4), 10);
  const m = parseInt(yyyymmdd.slice(4, 6), 10) - 1;
  const d = parseInt(yyyymmdd.slice(6, 8), 10);
  const dt = new Date(Date.UTC(y, m, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}${mm}${dd}`;
}
