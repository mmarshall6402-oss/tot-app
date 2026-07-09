// Translates the internal confidenceReasons[] audit trail (produced by
// lib/filter.js's and lib/filter-nfl.js's computeConfidence()) into short,
// plain-English bullets for the "Why we like it" UI. The raw strings are
// template-generated score adjustments (e.g. "+0.4 low variance",
// "-0.3 opponent lineup elite barrel rate (11.2%)") — real, computed factors,
// just written in scoring-audit jargon. This module only relabels them; it
// never invents a reason that isn't already in the array.

// Lines that describe internal score-clamping mechanics rather than a
// real-world factor a bettor would care about — dropped, not translated.
const DROP_PATTERNS = [
  /^pitching core:/,
  /^\[.*cap:.*\]$/,
];

// Order matters: first matching pattern wins. Patterns are anchored to the
// stable prefix of each template string; trailing interpolated numbers
// (percentages, decimals) are left unanchored so they still match.
const MLB_RULES = [
  [/^\+0\.4 low variance/, "Low variance in this matchup", "+"],
  [/^-0\.3 med variance/, "Some uncertainty in the matchup data", "-"],
  [/^-2 high variance/, "High variance — key data is missing or unstable", "-"],
  [/^-2\.5 signals mostly oppose pick/, "Most signals point against this pick", "-"],
  [/^-1\.5 signals lean against pick/, "Signals lean against this pick", "-"],
  [/^-0\.8 signals split/, "Signals are mixed on this one", "-"],
  [/^\+0\.4 meaningful SP sample/, "Starter has a reliable innings sample", "+"],
  [/^-2\.0 SP tiny sample/, "Starter has a very small sample — stats aren't stable yet", "-"],
  [/^-1\.2 SP small sample/, "Starter has a small innings sample", "-"],
  [/^-0\.6 opp SP tiny sample/, "Opposing starter has barely pitched — unstable stats", "-"],
  [/^-0\.3 opp SP small sample/, "Opposing starter has a small innings sample", "-"],
  [/^-0\.8 ERA beats xFIP/, "Starter's ERA looks better than his underlying numbers — regression risk", "-"],
  [/^-0\.4 ERA\/WHIP mismatch/, "Starter's ERA and WHIP don't line up — inconsistent performance", "-"],
  [/^-0\.8 high ERA/, "Starter has a high ERA", "-"],
  [/^\+0\.3 lineup advantage vs pitcher hand/, "Lineup has an edge against this pitcher's handedness", "+"],
  [/^-0\.5 lineup disadvantaged vs pitcher hand/, "Lineup is at a disadvantage against this pitcher's handedness", "-"],
  [/^-0\.1 lineup not yet posted/, "Lineup hasn't been posted yet", "-"],
  [/^\+0\.3 above-avg lineup/, "Above-average lineup by quality of contact", "+"],
  [/^-0\.3 below-avg lineup/, "Below-average lineup by quality of contact", "-"],
  [/^-0\.3 opponent lineup elite barrel rate/, "Opponent's lineup hits the ball exceptionally hard", "-"],
  [/^\+0\.15 line confirms/, "Betting line has moved to confirm this pick", "+"],
  [/^-1\.5 line contradicts/, "Betting line has moved against this pick", "-"],
  [/^-0\.8 model disagreement/, "Model and the market disagree sharply here", "-"],
  [/^-0\.5 thin true edge/, "The edge here is thin", "-"],
  [/^-0\.5 edge skepticism/, "Edge looks larger than is typically reliable", "-"],
  [/^\+0\.1 strong offensive form/, "Offense has been strong recently", "+"],
  [/^-0\.2 weak offensive form/, "Offense has been weak recently", "-"],
  [/^\+0\.1 offense hot last 7 days/, "Offense is hot over the last week", "+"],
  [/^-0\.2 offense cold last 7 days/, "Offense is cold over the last week", "-"],
  [/^-0\.3 opponent hot offense/, "Opponent's offense has been strong", "-"],
  [/^-0\.3 opponent on fire last 7 days/, "Opponent's offense is hot over the last week", "-"],
  [/^-0\.3 weak team record/, "Team has a weak overall record", "-"],
  [/^-0\.1 losing record/, "Team has a losing record", "-"],
];

const NFL_RULES = [
  [/^\+1 low variance/, "Low variance — data is complete", "+"],
  [/^-0\.5 med variance/, "Some data is missing or the sample is small", "-"],
  [/^-2 high variance/, "High variance — key data is missing", "-"],
  [/^\+1\.5 large edge/, "Model sees a large edge here", "+"],
  [/^\+0\.8 solid edge/, "Model sees a solid edge here", "+"],
  [/^-1\.0 thin edge/, "The edge here is thin", "-"],
  [/^-1\.0 model picks a heavy market underdog/, "Model is picking a significant underdog", "-"],
];

function magnitudeOf(raw) {
  const m = raw.match(/^([+-]\d+(?:\.\d+)?)/);
  return m ? Math.abs(parseFloat(m[1])) : 0;
}

// reasons: the raw confidenceReasons[] string array from pick.filter.
// sport: "mlb" | "nfl" — the two vocabularies don't overlap.
// Returns [{ text, sign: "+"|"-"|null, magnitude }], sorted by magnitude desc.
export function translateReasons(reasons, sport = "mlb") {
  const rules = sport === "nfl" ? NFL_RULES : MLB_RULES;
  const out = [];

  for (const raw of (reasons || [])) {
    if (DROP_PATTERNS.some(p => p.test(raw))) continue;

    const magnitude = magnitudeOf(raw);
    const match = rules.find(([pattern]) => pattern.test(raw));

    if (match) {
      out.push({ text: match[1], sign: match[2], magnitude });
    } else {
      // Unmapped string (future-proofing against reason text changes) — never
      // drop it silently, just show it with the numeric prefix stripped.
      const stripped = raw.replace(/^[+-]\d+(?:\.\d+)?\s*/, "").trim();
      const sign = raw.startsWith("-") ? "-" : raw.startsWith("+") ? "+" : null;
      out.push({ text: stripped || raw, sign, magnitude });
    }
  }

  return out.sort((a, b) => b.magnitude - a.magnitude);
}
