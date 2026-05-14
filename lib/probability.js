import { readFileSync } from "fs";
import { join } from "path";

const HOME_ADVANTAGE = 35; // Elo points, calibrated on 3 years of MLB data

let _eloRatings = null;
function loadElo() {
  if (_eloRatings) return _eloRatings;
  try {
    const raw = readFileSync(join(process.cwd(), "data/elo_ratings.json"), "utf8");
    _eloRatings = JSON.parse(raw);
  } catch {
    _eloRatings = {};
  }
  return _eloRatings;
}

function eloProb(homeTeam, awayTeam) {
  const ratings = loadElo();
  const homeElo = ratings[homeTeam] || 1500;
  const awayElo = ratings[awayTeam] || 1500;
  return 1 / (1 + Math.pow(10, (awayElo - homeElo - HOME_ADVANTAGE) / 400));
}

function normalize(value, min, max) {
  return Math.max(-1, Math.min(1, (value - (min + max) / 2) / ((max - min) / 2)));
}

// All inputs come from the pre-fetched /api/mlb data — no extra API calls needed.
export function getModelProbability(game, mlb) {
  const eloPrior = eloProb(game.homeTeam, game.awayTeam);

  if (!mlb) return eloPrior;

  // Season win% (standings)
  const homeWinPct = mlb.homeStandings?.winningPercentage ?? 0.500;
  const awayWinPct = mlb.awayStandings?.winningPercentage ?? 0.500;
  const standingsAdj = (homeWinPct - awayWinPct) * 0.25;

  // Recent 10-game hitting form (OPS is the best single offensive proxy)
  const homeOps = parseFloat(mlb.homeForm?.ops) || 0.720;
  const awayOps = parseFloat(mlb.awayForm?.ops) || 0.720;
  const formAdj = (homeOps - awayOps) * 0.30;

  // Starting pitcher (ERA + WHIP + K/9, normalized)
  const homeEra  = parseFloat(mlb.homePitcher?.era)           ?? 4.50;
  const awayEra  = parseFloat(mlb.awayPitcher?.era)           ?? 4.50;
  const homeWhip = parseFloat(mlb.homePitcher?.whip)          ?? 1.30;
  const awayWhip = parseFloat(mlb.awayPitcher?.whip)          ?? 1.30;
  const homeK9   = parseFloat(mlb.homePitcher?.strikeoutsPer9) ?? 8.0;
  const awayK9   = parseFloat(mlb.awayPitcher?.strikeoutsPer9) ?? 8.0;

  const homePScore = normalize(homeEra, 1.5, 7.0) * -0.40
                   + normalize(homeWhip, 0.8, 2.0) * -0.35
                   + normalize(homeK9, 4.0, 14.0)  *  0.25;
  const awayPScore = normalize(awayEra, 1.5, 7.0) * -0.40
                   + normalize(awayWhip, 0.8, 2.0) * -0.35
                   + normalize(awayK9, 4.0, 14.0)  *  0.25;
  const pitcherAdj = (homePScore - awayPScore) * 0.12;

  // Bullpen
  const homeBullEra = parseFloat(mlb.homeBullpen?.era) ?? 4.00;
  const awayBullEra = parseFloat(mlb.awayBullpen?.era) ?? 4.00;
  const bullpenAdj = (awayBullEra - homeBullEra) * 0.015;

  // Total live-stats adjustment
  const liveAdj = standingsAdj + formAdj + pitcherAdj + bullpenAdj;

  // Blend: Elo anchors to historical team strength; live stats shift for today's game
  const blended = eloPrior * 0.40 + (eloPrior + liveAdj) * 0.60;
  return Math.min(0.85, Math.max(0.15, blended));
}
