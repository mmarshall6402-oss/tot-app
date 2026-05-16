export function americanToDecimal(american) {
  if (american > 0) return (american / 100) + 1;
  return (100 / Math.abs(american)) + 1;
}

export function decimalToImplied(decimal) {
  return 1 / decimal;
}

export function removeVig(impliedHome, impliedAway) {
  const total = impliedHome + impliedAway;
  return { fairHome: impliedHome / total, fairAway: impliedAway / total };
}

export function calculateEdge(modelProb, impliedProb) {
  return modelProb - impliedProb;
}

export const BET_THRESHOLD = 0.03;

export function getTierLabel(edge) {
  if (edge >= 0.10) return { level: "High",   label: "🔥 Value Pick", emoji: "🔥" };
  if (edge >= 0.06) return { level: "Medium",  label: "✅ Solid Pick", emoji: "✅" };
  if (edge >= 0.02) return { level: "Low",     label: "👀 Lean",       emoji: "👀" };
  return               { level: "Tossup",  label: "🎲 Toss-Up",   emoji: "🎲" };
}

export const tierLabel = getTierLabel;
export function getConfidenceTier(edge) { return getTierLabel(edge); }
