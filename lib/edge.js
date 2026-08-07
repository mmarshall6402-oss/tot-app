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

function getTierLabel(edge) {
  if (edge >= 0.10) return { level: "High",   label: "🔥 Value Pick", emoji: "🔥" };
  if (edge >= 0.06) return { level: "Medium",  label: "✅ Solid Pick", emoji: "✅" };
  if (edge >= 0.02) return { level: "Low",     label: "👀 Lean",       emoji: "👀" };
  return               { level: "Tossup",  label: "🎲 Toss-Up",   emoji: "🎲" };
}

export function getConfidenceTier(edge) { return getTierLabel(edge); }

// Inverse of americanToDecimal + decimalToImplied — turns a bare probability
// into the fair (no-vig) American price for it. Used for repricing a pick at
// a line no sportsbook actually posted, where there's no real market price
// to remove vig from in the first place.
export function probToAmericanOdds(prob) {
  if (prob == null || prob <= 0 || prob >= 1) return null;
  const american = prob >= 0.5 ? -100 * (prob / (1 - prob)) : 100 * ((1 - prob) / prob);
  return Math.round(american);
}
