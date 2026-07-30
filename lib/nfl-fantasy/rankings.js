// The one production ranking pass — every live cron refresh and the
// backtest's "model" run both go through this function so they can never
// drift from each other (the backtest's asOfSeason truncation is the only
// difference between "live" and "historical replay").
import { buildPlayerProjection } from "./project.js";
import { computeReplacementLevels, DEFAULT_LEAGUE_CONFIG } from "./replacement.js";
import { computeVorp } from "./vorp.js";
import { assignTiers } from "./tiers.js";

export const POSITIONS = ["QB", "RB", "WR", "TE"];

export function groupByPlayer(rows) {
  const map = new Map();
  for (const r of rows) {
    if (!r.player_id) continue;
    const arr = map.get(r.player_id) || [];
    arr.push(r);
    map.set(r.player_id, arr);
  }
  return map;
}

export function mostRecentGame(games) {
  return [...games].sort((a, b) => b.season - a.season || b.week - a.week)[0];
}

export function buildRankings(playersById, { targetSeason, format, leagueConfig = DEFAULT_LEAGUE_CONFIG, vorpOptions } = {}) {
  const projectionsByPosition = { QB: [], RB: [], WR: [], TE: [] };
  const perPlayer = [];

  for (const [playerId, games] of playersById) {
    const latest = mostRecentGame(games);
    const position = latest?.position;
    if (!POSITIONS.includes(position)) continue;

    const projection = buildPlayerProjection(games, { asOfSeason: targetSeason, position, format });
    if (!projection) continue;

    const name = latest.player_display_name || latest.player_name || "Unknown";
    const team = latest.recent_team || latest.team || null;
    perPlayer.push({ playerId, name, position, team, projection });
    projectionsByPosition[position].push(projection);
  }

  const replacementLevels = computeReplacementLevels(projectionsByPosition, leagueConfig);
  const ranked = perPlayer
    .map((p) => ({
      ...p,
      replacementPoints: replacementLevels[p.position] || 0,
      ...computeVorp(p.projection, replacementLevels[p.position] || 0, vorpOptions),
    }))
    .sort((a, b) => b.ceilingVorp - a.ceilingVorp);

  return assignTiers(ranked).map((p, i) => ({ ...p, rankOverall: i + 1 }));
}
