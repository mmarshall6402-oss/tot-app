// Gap-detection tiering: a new tier starts wherever the drop to the next
// player is a statistical outlier among the gaps in this list — at least
// `stdDevMultiplier` standard deviations above the mean gap.
//
// Previously this compared every gap to a fixed fraction (minGap = 0.15) of
// the FULL list's value range (top overall pick down to a deep bench/
// waiver player). That meant a single adjacent-player step had to be ~15%
// of that entire span to count as a tier break — on a normal ~200-player
// board where most real gaps are small and gradual, no gap outside the very
// top of the board ever gets that big, so almost the whole list collapsed
// into tier 1. Comparing each gap to the local distribution of gaps instead
// of the global range finds real cliffs regardless of how long the list is
// or how big the top-to-bottom spread is.
//
// Degrades to a single tier (never throws) for 0-1 players or a perfectly
// uniform list (every gap identical, so none is an outlier) — same
// defensive posture as lib/filter.js elsewhere in this codebase.
export function assignTiers(rankedPlayers, { stdDevMultiplier = 2.0 } = {}) {
  if (rankedPlayers.length < 2) return rankedPlayers.map((p) => ({ ...p, tier: 1 }));

  const values = rankedPlayers.map((p) => p.ceilingVorp);
  // List is already sorted descending, so every gap is >= 0.
  const gaps = values.slice(1).map((v, i) => values[i] - v);
  const meanGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  const variance = gaps.reduce((a, b) => a + (b - meanGap) ** 2, 0) / gaps.length;
  const gapThreshold = meanGap + stdDevMultiplier * Math.sqrt(variance);

  let tier = 1;
  return rankedPlayers.map((p, i) => {
    if (i > 0 && gaps[i - 1] > 0 && gaps[i - 1] > gapThreshold) tier++;
    return { ...p, tier };
  });
}
