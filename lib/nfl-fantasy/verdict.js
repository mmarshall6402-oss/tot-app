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

const BUY_THRESHOLD = 1.5;
const FADE_THRESHOLD = -1.5;

export function computeVerdict(p) {
  let score = 0;
  const reasons = [];

  if (p.value_delta != null) {
    score += p.value_delta / 6;
    if (p.value_delta >= 8) reasons.push(`Going ${p.value_delta} spots later than the model ranks him — market value.`);
    else if (p.value_delta <= -8) reasons.push(`Going ${Math.abs(p.value_delta)} spots earlier than the model ranks him — market reach.`);
  }

  // Underperforming the preseason projection reads as a buy-low efficiency
  // case; outperforming it reads as regression risk — same framing as
  // RegressionBadge in components/NFLSection.js.
  if (p.regression_delta != null && p.games_played_actual >= 3) {
    score += -p.regression_delta / 4;
    if (p.regression_delta <= -3) reasons.push(`Underperforming its projection by ${Math.abs(p.regression_delta).toFixed(1)} PPG — buy-low efficiency case.`);
    else if (p.regression_delta >= 3) reasons.push(`Outperforming its projection by ${p.regression_delta.toFixed(1)} PPG — regression risk.`);
  }

  const penalty = injuryPenalty(p.injury_status);
  if (penalty) {
    score += penalty;
    reasons.push(`Carrying an injury designation (${p.injury_status}).`);
  }

  let verdict;
  if (score >= BUY_THRESHOLD) verdict = "BUY";
  else if (score <= FADE_THRESHOLD) verdict = "FADE";
  else verdict = "HOLD";

  return { verdict, score: Math.round(score * 10) / 10, reasons };
}
