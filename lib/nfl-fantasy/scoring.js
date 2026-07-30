// Standard fantasy scoring formulas (no league-specific quirks — this league
// runs vanilla PPR/Half-PPR/Standard: 1pt/25 pass yds, 4pt pass TD, -2 INT,
// 1pt/10 rush or rec yds, 6pt rush/rec TD, -2 fumble lost, 2pt for a 2pt
// conversion of any type). Computed from raw components rather than trusting
// a source's precomputed total so all three formats — including Half-PPR,
// which nflverse doesn't ship as its own column — fall out of one function.

const RECEPTION_POINTS = { ppr: 1, half_ppr: 0.5, standard: 0 };

// statLine fields follow nflverse's player_stats.csv naming. Any missing
// field is treated as 0 rather than throwing — a stat line from a
// non-skill-position week (e.g. a QB's rushing_yards) legitimately has gaps.
export function weeklyFantasyPoints(statLine, format = "ppr") {
  const s = statLine || {};
  const receptionPts = RECEPTION_POINTS[format] ?? RECEPTION_POINTS.ppr;
  const num = (v) => Number(v) || 0;

  const passingInterceptions = num(s.passing_interceptions ?? s.interceptions);
  const fumblesLost = num(s.sack_fumbles_lost) + num(s.rushing_fumbles_lost) + num(s.receiving_fumbles_lost) + num(s.fumbles_lost);
  const twoPointConversions = num(s.passing_2pt_conversions) + num(s.rushing_2pt_conversions) + num(s.receiving_2pt_conversions);

  const points =
    num(s.passing_yards) / 25 +
    num(s.passing_tds) * 4 +
    passingInterceptions * -2 +
    num(s.rushing_yards) / 10 +
    num(s.rushing_tds) * 6 +
    num(s.receiving_yards) / 10 +
    num(s.receiving_tds) * 6 +
    num(s.receptions) * receptionPts +
    fumblesLost * -2 +
    twoPointConversions * 2;

  return Math.round(points * 100) / 100;
}

export function seasonFantasyPoints(gameLogs, format = "ppr") {
  return (gameLogs || []).reduce((sum, g) => sum + weeklyFantasyPoints(g, format), 0);
}
