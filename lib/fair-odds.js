// "Should I Bet Now?" — compares the model's own win probability against the
// actual current market price for the picked side. Comparisons happen in
// probability space (not raw odds), since "better price" isn't well-defined
// comparing -140 to -170 directly without converting through implied
// probability first.

// American odds -> implied probability.
export function impliedProbFromOdds(odds) {
  if (odds == null) return null;
  return odds > 0 ? 100 / (odds + 100) : Math.abs(odds) / (Math.abs(odds) + 100);
}

// Model probability (0-1) -> the fair American odds for that probability,
// shown to the user as the "Fair" price alongside the actual "Current" price.
export function fairOddsFromProb(prob) {
  if (prob == null || prob <= 0 || prob >= 1) return null;
  return prob > 0.5
    ? Math.round(-(prob / (1 - prob)) * 100)
    : Math.round(((1 - prob) / prob) * 100);
}

// Implied probabilities within this margin are treated as "still fair"
// rather than flip-flopping the verdict on tiny odds moves.
const TOLERANCE = 0.015; // 1.5 percentage points

// currentOdds: actual current American odds for the picked side.
// modelProb: the model's own win probability (0-1) for that side.
// Returns null if either input is missing — caller should hide the block
// rather than render a meaningless verdict.
export function shouldBetNow(currentOdds, modelProb) {
  if (currentOdds == null || modelProb == null) return null;
  const currentImplied = impliedProbFromOdds(currentOdds);
  if (currentImplied == null) return null;

  const fairOdds = fairOddsFromProb(modelProb);
  const verdict = currentImplied <= modelProb + TOLERANCE ? "bet" : "wait";

  return { currentOdds, fairOdds, currentImplied, modelProb, verdict };
}
