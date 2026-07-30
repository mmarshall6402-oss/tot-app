// Replacement level per position for a standard 10-team league: the
// projected mean of the last plausible starter at that position, accounting
// for the shared FLEX slot. flexShare is a heuristic estimate of how often
// each position fills the FLEX spot — tunable, validated by the backtest.
export const DEFAULT_LEAGUE_CONFIG = {
  teams: 10,
  starters: { QB: 1, RB: 2, WR: 2, TE: 1 },
  flexSlots: 1,
  flexShare: { RB: 0.5, WR: 0.45, TE: 0.05 },
};

// projectionsByPosition: { QB: [{mean, ...}], RB: [...], ... }
export function computeReplacementLevels(projectionsByPosition, leagueConfig = DEFAULT_LEAGUE_CONFIG) {
  const { teams, starters, flexSlots, flexShare } = leagueConfig;
  const levels = {};
  for (const pos of Object.keys(starters)) {
    const sorted = [...(projectionsByPosition[pos] || [])].sort((a, b) => b.mean - a.mean);
    const replacementRank = teams * starters[pos] + Math.round(teams * flexSlots * (flexShare[pos] || 0));
    const idx = Math.min(sorted.length - 1, Math.max(0, replacementRank - 1));
    levels[pos] = sorted[idx]?.mean ?? 0;
  }
  return levels;
}
