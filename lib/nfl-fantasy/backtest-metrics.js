// Pure statistics helpers for the fantasy backtest — same "small reusable
// pure functions" pattern as lib/backtest/metrics.js.

export function spearmanCorrelation(pairs) {
  const n = pairs.length;
  if (n < 2) return null;
  const sumSqDiff = pairs.reduce((sum, p) => sum + (p.predictedRank - p.actualRank) ** 2, 0);
  return 1 - (6 * sumSqDiff) / (n * (n ** 2 - 1));
}

export function precisionAtN(predictedTopIds, actualTopIds) {
  if (!predictedTopIds.length) return null;
  const actualSet = new Set(actualTopIds);
  const hits = predictedTopIds.filter((id) => actualSet.has(id)).length;
  return hits / predictedTopIds.length;
}

// Validates the ceiling-bias mechanism directly, rather than through
// prediction-accuracy metrics that structurally can't validate it: a
// deliberate variance-seeking tilt will never out-predict a pure
// expected-value ranking (plain VORP) on backward-looking realized-points
// accuracy — that's what plain VORP is defined to optimize for, so tying or
// slightly trailing it on precision@N/spearman is expected, not a bug.
// What SHOULD hold: among players whose rank the ceiling bias actually
// changed relative to plain VORP, the ones it promoted should have had
// higher real single-game ceilings than the ones it demoted.
export function ceilingPromotionCheck(modelTopIds, plainTopIds, bestGameById) {
  const modelSet = new Set(modelTopIds);
  const plainSet = new Set(plainTopIds);
  const promoted = modelTopIds.filter((id) => !plainSet.has(id));
  const demoted = plainTopIds.filter((id) => !modelSet.has(id));

  const avg = (ids) => {
    const scores = ids.map((id) => bestGameById.get(id)).filter((s) => s != null);
    return scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
  };

  return {
    promotedCount: promoted.length,
    demotedCount: demoted.length,
    avgPromotedBestGame: avg(promoted),
    avgDemotedBestGame: avg(demoted),
  };
}
