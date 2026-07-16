// lib/backtest/elo-walkforward.js
//
// Reconstructs a historical Elo rating path from a neutral seed by replaying
// data/games.json chronologically. There is no recorded historical Elo time
// series in this repo (data/elo_ratings.json is a single current snapshot),
// so this is a documented simplifying assumption, not a recovery of the real
// historical path.
//
// Uses the *exact* update formula from lib/elo-db.js#updateEloAfterGame
// (K=20, home-advantage=35) reimplemented here as pure in-memory math (no
// Supabase round-trip per game) — kept in sync by cross-reference; if that
// formula changes, this one must change with it.

const DEFAULT_ELO = 1500;

function expected(eloA, eloB) {
  return 1 / (1 + Math.pow(10, (eloB - eloA) / 400));
}

// games: chronologically sorted [{ date, homeTeam, awayTeam, homeWon }, ...]
// Returns one entry per game with the Elo rating *before* that game was
// applied (the only thing safe to feed into a probability prediction),
// plus the final ratings table after replaying all games.
export function computeWalkForwardElo(games, { k = 20, homeAdvantage = 35, seed = DEFAULT_ELO } = {}) {
  const ratings = {};
  const perGame = new Array(games.length);

  for (let i = 0; i < games.length; i++) {
    const { homeTeam, awayTeam, homeWon } = games[i];
    const homeElo = ratings[homeTeam] ?? seed;
    const awayElo = ratings[awayTeam] ?? seed;

    perGame[i] = { preGameHomeElo: homeElo, preGameAwayElo: awayElo };

    const expHome = expected(homeElo + homeAdvantage, awayElo);
    const actual = homeWon ? 1 : 0;

    ratings[homeTeam] = homeElo + k * (actual - expHome);
    ratings[awayTeam] = awayElo + k * ((1 - actual) - (1 - expHome));
  }

  return { perGame, finalRatings: ratings };
}
