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
