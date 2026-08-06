// Maps nflverse-style team abbreviations (used in nfl_fantasy_rankings.team,
// see sql/012_nfl_fantasy.sql) to the full team names The Odds API and ESPN
// both use for game/roster lookups (e.g. "Kansas City Chiefs"). A couple of
// abbreviations get two entries since different upstream sources disagree
// (Washington, Jacksonville, the LA teams).
const ABBR_TO_FULL = {
  ARI: "Arizona Cardinals",
  ATL: "Atlanta Falcons",
  BAL: "Baltimore Ravens",
  BUF: "Buffalo Bills",
  CAR: "Carolina Panthers",
  CHI: "Chicago Bears",
  CIN: "Cincinnati Bengals",
  CLE: "Cleveland Browns",
  DAL: "Dallas Cowboys",
  DEN: "Denver Broncos",
  DET: "Detroit Lions",
  GB:  "Green Bay Packers",
  HOU: "Houston Texans",
  IND: "Indianapolis Colts",
  JAX: "Jacksonville Jaguars",
  JAC: "Jacksonville Jaguars",
  KC:  "Kansas City Chiefs",
  LV:  "Las Vegas Raiders",
  LVR: "Las Vegas Raiders",
  OAK: "Las Vegas Raiders",
  LAC: "Los Angeles Chargers",
  SD:  "Los Angeles Chargers",
  LAR: "Los Angeles Rams",
  LA:  "Los Angeles Rams",
  STL: "Los Angeles Rams",
  MIA: "Miami Dolphins",
  MIN: "Minnesota Vikings",
  NE:  "New England Patriots",
  NO:  "New Orleans Saints",
  NYG: "New York Giants",
  NYJ: "New York Jets",
  PHI: "Philadelphia Eagles",
  PIT: "Pittsburgh Steelers",
  SF:  "San Francisco 49ers",
  SEA: "Seattle Seahawks",
  TB:  "Tampa Bay Buccaneers",
  TEN: "Tennessee Titans",
  WAS: "Washington Commanders",
  WSH: "Washington Commanders",
};

export function nflTeamFullName(abbrOrName) {
  if (!abbrOrName) return null;
  const trimmed = abbrOrName.trim();
  if (ABBR_TO_FULL[trimmed.toUpperCase()]) return ABBR_TO_FULL[trimmed.toUpperCase()];
  // Already a full display name (e.g. from ESPN's team.displayName) — pass through.
  return trimmed;
}
