// Shared NFL pick-building logic — used by both app/api/nfl/picks/route.js
// (on-demand, Pro-gated) and app/api/cron/nfl-picks/route.js (CRON_SECRET-gated
// admin/regen trigger) so the two entry points can't drift out of sync.

import { getNFLTeamStats } from "./nfl-stats.js";
import { getNFLModelProbability, getNFLSpreadCoverProbability, setNFLEloRatings } from "./nfl-probability.js";
import { applyNFLFilterLayer } from "./filter-nfl.js";
import { calculateEdge } from "./edge.js";
import { getEloRatings } from "./elo-db.js";

const fmtRecord = (s) => s ? `${s.wins}-${s.losses}${s.ties ? `-${s.ties}` : ""}` : null;

function fmtMatchupSide(stats) {
  if (!stats || stats.pointsForPerGame == null) return "stats unavailable";
  const ppg = stats.pointsForPerGame.toFixed(1);
  const papg = stats.pointsAgainstPerGame != null ? stats.pointsAgainstPerGame.toFixed(1) : "?";
  const form = stats.last3NetDiff != null ? `, last 3: ${stats.last3NetDiff >= 0 ? "+" : ""}${stats.last3NetDiff.toFixed(1)} net` : "";
  return `${fmtRecord(stats) || "0-0"}, ${ppg} PPG / ${papg} PAPG${form}`;
}

function deriveTier(filter) {
  const isBet = filter.verdict === "BET";
  if (!isBet) return { level: "Low", label: "👀 Lean", emoji: "👀" };
  if (filter.confidence >= 7.5) return { level: "High", label: "🔥 Value Pick", emoji: "🔥" };
  if (filter.confidence >= 6.5) return { level: "Medium", label: "✅ Solid Pick", emoji: "✅" };
  return { level: "Low", label: "👀 Lean", emoji: "👀" };
}

// Builds both a moneyline and (if a spread line exists) a spread pick for one game.
// nfl: { home, away } team-stats objects from getNFLTeamStats.
function buildNFLGamePicks(game, nfl) {
  const picks = [];
  const homeRecord = fmtRecord(nfl?.home);
  const awayRecord = fmtRecord(nfl?.away);
  const matchup = { home: fmtMatchupSide(nfl?.home), away: fmtMatchupSide(nfl?.away) };
  const base = {
    homeTeam: game.homeTeam, awayTeam: game.awayTeam,
    homeRecord, awayRecord, commenceTime: game.commenceTime, matchup,
  };

  if (game.homeOdds != null && game.awayOdds != null) {
    const modelProb = getNFLModelProbability(game, nfl);
    const pick = (game.homeImplied != null ? calculateEdge(modelProb, game.homeImplied) >= 0 : modelProb >= 0.5)
      ? game.homeTeam : game.awayTeam;
    const filter = applyNFLFilterLayer(pick, game, nfl, modelProb, { marketType: "moneyline" });
    picks.push({
      ...base,
      id: `${game.id}-ml`, marketType: "moneyline",
      homeOdds: game.homeOdds, awayOdds: game.awayOdds,
      pick, edge: filter.trueEdgePct, isBet: filter.verdict === "BET",
      tier: deriveTier(filter), filter,
    });
  }

  if (game.spread != null && game.homeSpreadOdds != null && game.awaySpreadOdds != null) {
    const homeCoverProb = getNFLSpreadCoverProbability(game, nfl, game.spread);
    const pick = homeCoverProb >= 0.5 ? game.homeTeam : game.awayTeam;
    const filter = applyNFLFilterLayer(pick, game, nfl, homeCoverProb, { marketType: "spread" });
    picks.push({
      ...base,
      id: `${game.id}-spread`, marketType: "spread",
      spread: game.spread, homeSpreadOdds: game.homeSpreadOdds, awaySpreadOdds: game.awaySpreadOdds,
      pick, edge: filter.trueEdgePct, isBet: filter.verdict === "BET",
      tier: deriveTier(filter), filter,
    });
  }

  return picks;
}

export async function buildNFLPicksForGames(games, supabase) {
  const ratings = await getEloRatings(supabase, "nfl_team_elo", null);
  setNFLEloRatings(ratings);

  const perGame = await Promise.all(games.map(async (game) => {
    const stats = await getNFLTeamStats([game.homeTeam, game.awayTeam], game.commenceTime).catch(() => ({}));
    return { game, nfl: { home: stats[game.homeTeam], away: stats[game.awayTeam] } };
  }));

  const picks = perGame.flatMap(({ game, nfl }) => buildNFLGamePicks(game, nfl));

  const verdictRank = v => ({ BET: 0, PASS: 1, TRAP: 2 }[v] ?? 3);
  picks.sort((a, b) => {
    const betDiff = (b.isBet ? 1 : 0) - (a.isBet ? 1 : 0);
    if (betDiff !== 0) return betDiff;
    const vd = verdictRank(a.filter?.verdict) - verdictRank(b.filter?.verdict);
    if (vd !== 0) return vd;
    return (b.filter?.trueEdgePct || 0) - (a.filter?.trueEdgePct || 0);
  });

  return picks;
}
