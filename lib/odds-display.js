// Client-safe pure math for displaying odds as win probabilities and
// tracking line movement — no network calls, works off odds already
// present in a pick object.

function americanToDecimal(american) {
  if (american > 0) return (american / 100) + 1;
  return (100 / Math.abs(american)) + 1;
}

// De-vigged implied win probability for both sides of a moneyline, as
// whole-number percentages that sum to 100.
export function impliedWinPct(homeOdds, awayOdds) {
  if (homeOdds == null || awayOdds == null) return null;
  const homeImplied = 1 / americanToDecimal(homeOdds);
  const awayImplied = 1 / americanToDecimal(awayOdds);
  const total = homeImplied + awayImplied;
  if (!total) return null;
  const home = Math.round((homeImplied / total) * 100);
  return { home, away: 100 - home };
}

// Compares a team's implied win % at open vs. now and returns a movement
// direction. Returns null when either side is missing (no data yet).
export function oddsMovement(openOdds, currentOdds, oppOpenOdds, oppCurrentOdds) {
  if (openOdds == null || currentOdds == null || oppOpenOdds == null || oppCurrentOdds == null) return null;
  const openPct = impliedWinPct(openOdds, oppOpenOdds);
  const currentPct = impliedWinPct(currentOdds, oppCurrentOdds);
  if (!openPct || !currentPct) return null;
  const delta = currentPct.home - openPct.home;
  if (delta === 0) return { direction: "flat", delta: 0 };
  return { direction: delta > 0 ? "up" : "down", delta: Math.abs(delta) };
}
