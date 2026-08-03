// Backtests lib/nfl-fantasy/probability.js's head-to-head Start/Sit
// probability against real historical weeks — the same "replay the real
// production pipeline against a season whose outcome is known" approach as
// backtest-runner.js, just scored per-week/per-pair instead of per-season
// rank. This is what seeds fantasy_probability_log (sql/018) so the public
// calibration page (app/calibration/page.js) has real numbers on day one,
// instead of waiting a full season for live Start/Sit calls to accumulate.
import { groupByPlayer, buildRankings, POSITIONS } from "./rankings.js";
import { weeklyFantasyPoints } from "./scoring.js";
import { headToHeadProbability } from "./probability.js";
import { buildAgeById } from "./age.js";

// Fantasy leagues run weeks 1-17 (schedule-adjustment.js's PLAYOFF_WEEKS
// treats 15-17 as the fantasy playoffs) — weeks 18+ are the NFL's extra
// regular-season/playoff weeks that don't count for a season-long league.
const FANTASY_WEEKS = Array.from({ length: 17 }, (_, i) => i + 1);

// Realistic start/sit questions happen within the startable range at a
// position, not between the WR1 and the WR90 — capping candidates here
// keeps the pair count tractable and the comparisons meaningful. Matches
// backtest-runner.js's CEILING_CHECK_N depth for the same reason.
const TOP_N_PER_POSITION = 24;

// Maps a buildRankings() player object to the same shape headToHeadProbability
// expects from a live nfl_fantasy_rankings row. injury_status is deliberately
// null — there's no historical this-week injury designation to replay, so
// the backtest scores the model's projection-driven probability on its own
// merits rather than crediting it for live injury info it wouldn't have had.
function toRankingRow(p) {
  return {
    name: p.name,
    tier: p.tier,
    injury_status: null,
    projected_points: p.projection.mean,
    ceiling_points: p.projection.p80,
    floor_points: p.projection.p20,
    games_projected: p.projection.gamesProjected,
  };
}

export function runProbabilityBacktest({ playerStatsRows, playersRows, targetSeason, format = "ppr" }) {
  const normalized = playerStatsRows.map((r) => ({ ...r, season: Number(r.season), week: Number(r.week) }));
  const playersById = groupByPlayer(normalized);
  const ageById = buildAgeById(playersRows, targetSeason);

  const ranked = buildRankings(playersById, { targetSeason, format, ageById });

  const topByPosition = {};
  for (const pos of POSITIONS) {
    topByPosition[pos] = ranked
      .filter((p) => p.position === pos)
      .sort((a, b) => b.ceilingVorp - a.ceilingVorp)
      .slice(0, TOP_N_PER_POSITION);
  }

  const predictions = [];
  for (const week of FANTASY_WEEKS) {
    for (const pos of POSITIONS) {
      const candidates = topByPosition[pos]
        .map((p) => {
          const games = playersById.get(p.playerId) || [];
          const weekGame = games.find((g) => g.season === targetSeason && g.week === week);
          if (!weekGame) return null; // bye/injury/didn't play — no real outcome to grade against
          return { ...p, actualPoints: weeklyFantasyPoints(weekGame, format) };
        })
        .filter(Boolean);

      for (let i = 0; i < candidates.length; i++) {
        for (let j = i + 1; j < candidates.length; j++) {
          const a = candidates[i], b = candidates[j];
          const probability = headToHeadProbability(toRankingRow(a), toRankingRow(b));
          if (!probability) continue;

          const actualWinner = a.actualPoints === b.actualPoints ? "push" : a.actualPoints > b.actualPoints ? "A" : "B";
          predictions.push({
            season: targetSeason,
            week,
            position: pos,
            playerAId: a.playerId,
            playerAName: a.name,
            playerBId: b.playerId,
            playerBName: b.name,
            predictedProbA: probability.playerAProbability,
            actualPointsA: a.actualPoints,
            actualPointsB: b.actualPoints,
            actualWinner,
          });
        }
      }
    }
  }

  return { targetSeason, format, predictions };
}
