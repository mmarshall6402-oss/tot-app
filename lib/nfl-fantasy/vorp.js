// ceilingWeight is where "favor high-ceiling players" actually lives: it's
// blended into the ranking metric itself, not into replacement level, so
// positional-scarcity math stays correct while upside players still get
// pulled up the board. Tunable heuristic, validated by the backtest.
export function computeVorp(projection, replacementPoints, { ceilingWeight = 0.35 } = {}) {
  const vorp = projection.mean - replacementPoints;
  const ceilingVorp = (1 - ceilingWeight) * vorp + ceilingWeight * (projection.p80 - replacementPoints);
  return {
    vorp: Math.round(vorp * 100) / 100,
    ceilingVorp: Math.round(ceilingVorp * 100) / 100,
  };
}
