// Gap-detection tiering: a new tier starts wherever the drop to the next
// player exceeds minGap * the position's overall value range. Degrades to a
// single tier (never throws) if the range is degenerate — same defensive
// posture as lib/filter.js elsewhere in this codebase.
export function assignTiers(rankedPlayers, { minGap = 0.15 } = {}) {
  if (!rankedPlayers.length) return [];
  const values = rankedPlayers.map((p) => p.ceilingVorp);
  const range = Math.max(...values) - Math.min(...values);
  const gapThreshold = range > 0 ? range * minGap : Infinity;

  let tier = 1;
  return rankedPlayers.map((p, i) => {
    if (i > 0 && values[i - 1] - values[i] > gapThreshold) tier++;
    return { ...p, tier };
  });
}
