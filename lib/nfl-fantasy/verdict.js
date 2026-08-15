// Draft-day "Buy / Hold / Fade" verdict — synthesizes signals this codebase
// already computes (ADP value_delta from adp.js, regression_delta from
// regression.js, injury_status) into one at-a-glance call, the same way a
// human would eyeball the Cheat Sheet's existing badge row and form an
// opinion. Deliberately doesn't reach for data this app has no source for
// (PFF-style route/coverage splits, PROE, O-line grades) — every input here
// is a column nfl_fantasy_rankings already carries.
const INJURY_PENALTY = {
  out: -3,
  doubtful: -2,
  questionable: -1,
};

function injuryPenalty(status) {
  if (!status) return 0;
  const s = status.toLowerCase();
  if (/\b(out|ir|pup|nfi|susp)\b/.test(s)) return INJURY_PENALTY.out;
  if (/doubtful/.test(s)) return INJURY_PENALTY.doubtful;
  if (/questionable/.test(s)) return INJURY_PENALTY.questionable;
  return 0;
}

const BUY_THRESHOLD = 1.2;
const FADE_THRESHOLD = -1.2;

// Every input here can legitimately be absent at once — regression_delta is
// null for the entire player pool before the season has 3 games in the
// books (see regression.js), and value_delta depends on a third-party ADP
// feed that's known to fail or under-match by name (see the adpIndex.size
// === 0 branch in app/api/cron/nfl-fantasy-rankings). A player with none of
// these isn't "fairly priced" — there's simply nothing to grade yet, which
// is a different claim than HOLD and shouldn't be badged as one. hasSignal
// tracks whether at least one real input contributed before a HOLD verdict
// is allowed to mean anything.
export function computeVerdict(p) {
  let score = 0;
  let hasSignal = false;
  const reasons = [];

  if (p.value_delta != null) {
    hasSignal = true;
    score += p.value_delta / 5;
    if (p.value_delta >= 6) reasons.push(`Going ${p.value_delta} spots later than the model ranks him — market value.`);
    else if (p.value_delta <= -6) reasons.push(`Going ${Math.abs(p.value_delta)} spots earlier than the model ranks him — market reach.`);
  }

  // Underperforming the preseason projection reads as a buy-low efficiency
  // case; outperforming it reads as regression risk — same framing as
  // RegressionBadge in components/NFLSection.js.
  if (p.regression_delta != null && p.games_played_actual >= 3) {
    hasSignal = true;
    score += -p.regression_delta / 3;
    if (p.regression_delta <= -3) reasons.push(`Underperforming its projection by ${Math.abs(p.regression_delta).toFixed(1)} PPG — buy-low efficiency case.`);
    else if (p.regression_delta >= 3) reasons.push(`Outperforming its projection by ${p.regression_delta.toFixed(1)} PPG — regression risk.`);
  }

  const penalty = injuryPenalty(p.injury_status);
  if (penalty) {
    hasSignal = true;
    score += penalty;
    reasons.push(`Carrying an injury designation (${p.injury_status}).`);
  }

  if (!hasSignal) return { verdict: "NO_SIGNAL", score: 0, reasons: [] };

  let verdict;
  if (score >= BUY_THRESHOLD) verdict = "BUY";
  else if (score <= FADE_THRESHOLD) verdict = "FADE";
  else verdict = "HOLD";

  return { verdict, score: Math.round(score * 10) / 10, reasons };
}
