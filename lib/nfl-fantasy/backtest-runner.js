// Replays the real production ranking pipeline (lib/nfl-fantasy/rankings.js
// — never a parallel reimplementation) against a season the data already
// knows the outcome of, so accuracy can be checked before the user trusts it
// for a real draft. Also runs two required baselines so a good-looking
// number can't hide a model that adds no value: plain VORP (no ceiling bias,
// via the same production function with ceilingWeight: 0) and a naive "just
// re-rank by last season's finish."
import { groupByPlayer, mostRecentGame, buildRankings, POSITIONS } from "./rankings.js";
import { seasonFantasyPoints, weeklyFantasyPoints } from "./scoring.js";
import { computeReplacementLevels, DEFAULT_LEAGUE_CONFIG } from "./replacement.js";
import { computeVorp } from "./vorp.js";
import { assignTiers } from "./tiers.js";
import { spearmanCorrelation, precisionAtN, ceilingPromotionCheck } from "./backtest-metrics.js";

// Wider than the topN used for precision@N — the ceiling bias mostly
// reshuffles within a group rather than crossing a tight cutoff, so a
// narrower window (e.g. top-12) rarely shows any promotions/demotions at all.
const CEILING_CHECK_N = 24;

function bestGameByIdForSeason(playersById, targetSeason, format) {
  const map = new Map();
  for (const [playerId, games] of playersById) {
    const seasonGames = games.filter((g) => g.season === targetSeason);
    if (!seasonGames.length) continue;
    map.set(playerId, Math.max(...seasonGames.map((g) => weeklyFantasyPoints(g, format))));
  }
  return map;
}

// Not a production code path — naive baseline intentionally skips
// buildPlayerProjection entirely (no recency weighting, no aging curve, no
// ceiling) to prove the real model adds value over the simplest possible
// alternative: literally just last season's finish.
function buildNaiveLastSeasonRanking(playersById, { targetSeason, format, leagueConfig }) {
  const projectionsByPosition = { QB: [], RB: [], WR: [], TE: [] };
  const perPlayer = [];

  for (const [playerId, games] of playersById) {
    const latest = mostRecentGame(games);
    const position = latest?.position;
    if (!POSITIONS.includes(position)) continue;

    const priorSeasonGames = games.filter((g) => g.season === targetSeason - 1);
    if (!priorSeasonGames.length) continue;
    const total = seasonFantasyPoints(priorSeasonGames, format);
    const projection = { mean: total, p80: total, gamesProjected: priorSeasonGames.length };

    const name = latest.player_display_name || latest.player_name || "Unknown";
    perPlayer.push({ playerId, name, position, projection });
    projectionsByPosition[position].push(projection);
  }

  const replacementLevels = computeReplacementLevels(projectionsByPosition, leagueConfig);
  const ranked = perPlayer
    .map((p) => ({ ...p, ...computeVorp(p.projection, replacementLevels[p.position] || 0) }))
    .sort((a, b) => b.ceilingVorp - a.ceilingVorp);

  return assignTiers(ranked).map((p, i) => ({ ...p, rankOverall: i + 1 }));
}

function actualResultsByPosition(playersById, { targetSeason, format }) {
  const byPosition = { QB: [], RB: [], WR: [], TE: [] };
  for (const [playerId, games] of playersById) {
    const seasonGames = games.filter((g) => g.season === targetSeason);
    if (!seasonGames.length) continue;
    const position = mostRecentGame(seasonGames)?.position;
    if (!POSITIONS.includes(position)) continue;
    const points = seasonFantasyPoints(seasonGames, format);
    byPosition[position].push({ playerId, points });
  }
  for (const pos of POSITIONS) {
    byPosition[pos].sort((a, b) => b.points - a.points);
    byPosition[pos].forEach((p, i) => { p.rankPosition = i + 1; });
  }
  return byPosition;
}

function evaluateRanking(ranked, actualByPosition, topN) {
  const actualRankById = new Map();
  for (const pos of POSITIONS) for (const p of actualByPosition[pos]) actualRankById.set(p.playerId, p.rankPosition);

  const byPosition = {};
  for (const pos of POSITIONS) {
    const predictedInPos = ranked
      .filter((p) => p.position === pos)
      .sort((a, b) => b.ceilingVorp - a.ceilingVorp)
      .map((p, i) => ({ ...p, rankPosition: i + 1 }));

    const pairs = predictedInPos
      .filter((p) => actualRankById.has(p.playerId))
      .map((p) => ({ predictedRank: p.rankPosition, actualRank: actualRankById.get(p.playerId) }));

    byPosition[pos] = {
      spearman: spearmanCorrelation(pairs),
      precisionAtN: precisionAtN(predictedInPos.slice(0, topN).map((p) => p.playerId), actualByPosition[pos].slice(0, topN).map((p) => p.playerId)),
      n: pairs.length,
    };
  }
  return byPosition;
}

export function runFantasyBacktest({ playerStatsRows, targetSeason, format = "ppr", leagueConfig = DEFAULT_LEAGUE_CONFIG, topN = 12 }) {
  const normalized = playerStatsRows.map((r) => ({ ...r, season: Number(r.season), week: Number(r.week) }));
  const playersById = groupByPlayer(normalized);
  const actualByPosition = actualResultsByPosition(playersById, { targetSeason, format });

  const modelRanking = buildRankings(playersById, { targetSeason, format, leagueConfig });
  const plainVorpRanking = buildRankings(playersById, { targetSeason, format, leagueConfig, vorpOptions: { ceilingWeight: 0 } });
  const naiveRanking = buildNaiveLastSeasonRanking(playersById, { targetSeason, format, leagueConfig });

  const bestGameById = bestGameByIdForSeason(playersById, targetSeason, format);
  const ceilingPromotion = {};
  for (const pos of POSITIONS) {
    const modelTop = modelRanking.filter((p) => p.position === pos).sort((a, b) => b.ceilingVorp - a.ceilingVorp).slice(0, CEILING_CHECK_N).map((p) => p.playerId);
    const plainTop = plainVorpRanking.filter((p) => p.position === pos).sort((a, b) => b.ceilingVorp - a.ceilingVorp).slice(0, CEILING_CHECK_N).map((p) => p.playerId);
    ceilingPromotion[pos] = ceilingPromotionCheck(modelTop, plainTop, bestGameById);
  }

  return {
    targetSeason,
    format,
    rows: modelRanking,
    metrics: {
      model: evaluateRanking(modelRanking, actualByPosition, topN),
      plainVorpBaseline: evaluateRanking(plainVorpRanking, actualByPosition, topN),
      naiveLastSeasonBaseline: evaluateRanking(naiveRanking, actualByPosition, topN),
      ceilingPromotionCheck: ceilingPromotion,
    },
  };
}
