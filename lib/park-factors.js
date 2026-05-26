// Park run-environment factors keyed by home team.
// Values = expected run differential vs league-average park (9-run game baseline).
// Source: multi-year Retrosheet park-adjusted data + Statcast park factors.
// Positive = hitter-friendly, Negative = pitcher-friendly.

export const PARK_FACTORS = {
  "Colorado Rockies":       +1.45,  // Coors — most extreme in MLB
  "Boston Red Sox":         +0.55,  // Fenway, short porch + wall
  "Cincinnati Reds":        +0.40,  // GABP, small footprint
  "Arizona Diamondbacks":   +0.35,  // Chase Field, heat/altitude
  "Texas Rangers":          +0.30,  // Globe Life Field
  "New York Yankees":       +0.25,  // short RF porch
  "Chicago Cubs":           +0.20,  // Wrigley, wind-dependent
  "Baltimore Orioles":      +0.15,  // Camden Yards
  "Philadelphia Phillies":  +0.15,  // Citizens Bank
  "Atlanta Braves":         +0.10,  // Truist Park
  "Detroit Tigers":         +0.05,  // Comerica
  "Kansas City Royals":     +0.05,  // Kauffman
  "Washington Nationals":   +0.00,  // Nationals Park neutral
  "New York Mets":          +0.00,  // Citi Field neutral
  "St. Louis Cardinals":    -0.05,  // Busch
  "Cleveland Guardians":    -0.05,  // Progressive Field
  "Pittsburgh Pirates":     -0.10,  // PNC Park
  "Miami Marlins":          -0.10,  // LoanDepot, indoor/turf
  "Minnesota Twins":        -0.15,  // Target Field
  "Chicago White Sox":      -0.15,  // Guaranteed Rate
  "Oakland Athletics":      -0.20,  // (transitional)
  "Athletics":              -0.20,  // alias — MLB API drops "Oakland" branding
  "Toronto Blue Jays":      -0.20,  // Rogers Centre, turf
  "Los Angeles Dodgers":    -0.25,  // Dodger Stadium
  "Houston Astros":         -0.25,  // Minute Maid, retractable
  "Los Angeles Angels":     -0.25,  // Angel Stadium
  "Tampa Bay Rays":         -0.30,  // Tropicana dome
  "San Francisco Giants":   -0.35,  // Oracle Park, sea wind
  "Milwaukee Brewers":      -0.35,  // American Family Field
  "Seattle Mariners":       -0.40,  // T-Mobile Park
  "San Diego Padres":       -0.50,  // Petco Park — most pitcher-friendly
};

export function getParkFactor(homeTeam) {
  return PARK_FACTORS[homeTeam] ?? 0;
}

// HR park factors by batter handedness. Values relative to league average (1.0 = neutral).
// LHB = left-handed batter pulling to RF. RHB = right-handed batter pulling to LF.
// Source: multi-year Statcast HR park factors from Baseball Savant.
export const HR_FACTORS = {
  //                                             LHB    RHB
  "New York Yankees":       { lhb: 1.38, rhb: 1.00 }, // very short RF porch (314 ft)
  "Boston Red Sox":         { lhb: 1.18, rhb: 0.82 }, // Pesky Pole (302 ft); Green Monster kills RHB HRs
  "Cincinnati Reds":        { lhb: 1.15, rhb: 1.10 }, // small park, HR-friendly both ways
  "Texas Rangers":          { lhb: 1.12, rhb: 1.08 }, // Globe Life, warm/dry air
  "Arizona Diamondbacks":   { lhb: 1.10, rhb: 1.08 }, // altitude + heat
  "Philadelphia Phillies":  { lhb: 1.10, rhb: 1.05 }, // shorter RF
  "Colorado Rockies":       { lhb: 1.38, rhb: 1.35 }, // Coors altitude
  "Chicago Cubs":           { lhb: 1.08, rhb: 1.05 }, // Wrigley, wind-variable
  "Baltimore Orioles":      { lhb: 1.05, rhb: 1.08 }, // Camden Yards, short CF power alley
  "Atlanta Braves":         { lhb: 1.05, rhb: 1.02 }, // Truist Park
  "Pittsburgh Pirates":     { lhb: 1.05, rhb: 0.90 }, // PNC: short RF (320 ft) great for LHB; 21-ft LF wall suppresses RHB
  "Kansas City Royals":     { lhb: 1.02, rhb: 0.98 }, // Kauffman, spacious
  "Detroit Tigers":         { lhb: 1.00, rhb: 0.95 }, // Comerica, deep CF
  "Washington Nationals":   { lhb: 0.98, rhb: 1.00 }, // Nationals Park
  "New York Mets":          { lhb: 0.95, rhb: 1.00 }, // Citi Field, LF wall suppresses LHB
  "St. Louis Cardinals":    { lhb: 0.96, rhb: 0.98 }, // Busch, fairly neutral
  "Cleveland Guardians":    { lhb: 0.95, rhb: 1.00 }, // Progressive Field
  "Chicago White Sox":      { lhb: 0.96, rhb: 0.98 }, // Guaranteed Rate Field
  "Minnesota Twins":        { lhb: 0.92, rhb: 0.95 }, // Target Field, cold air early season
  "Miami Marlins":          { lhb: 0.90, rhb: 0.95 }, // LoanDepot, spacious
  "Oakland Athletics":      { lhb: 0.90, rhb: 0.90 }, // transitional
  "Athletics":              { lhb: 0.90, rhb: 0.90 }, // alias — MLB API drops "Oakland" branding
  "Toronto Blue Jays":      { lhb: 0.95, rhb: 0.95 }, // Rogers Centre: symmetric 328/400/328, turf — no HR boost
  "Houston Astros":         { lhb: 0.92, rhb: 0.95 }, // Minute Maid (Crawford Boxes boost LHB slightly)
  "Los Angeles Dodgers":    { lhb: 0.88, rhb: 0.92 }, // Dodger Stadium, spacious pitcher park
  "Los Angeles Angels":     { lhb: 0.88, rhb: 0.90 }, // Angel Stadium, deep OF
  "Tampa Bay Rays":         { lhb: 0.85, rhb: 0.88 }, // Tropicana Field dome
  "San Francisco Giants":   { lhb: 0.78, rhb: 0.88 }, // Oracle Park, sea wind kills LHB HRs to RF
  "Milwaukee Brewers":      { lhb: 0.88, rhb: 0.90 }, // American Family Field
  "Seattle Mariners":       { lhb: 0.82, rhb: 0.88 }, // T-Mobile Park, deep CF/RF
  "San Diego Padres":       { lhb: 0.72, rhb: 0.78 }, // Petco — most HR-suppressive in MLB
};

// Returns average HR factor for a park, optionally filtered by batter handedness.
export function getHrFactor(homeTeam, batterHand = null) {
  const f = HR_FACTORS[homeTeam];
  if (!f) return 1.0;
  if (batterHand === "L") return f.lhb;
  if (batterHand === "R") return f.rhb;
  return (f.lhb + f.rhb) / 2;
}

// Run environment → win probability impact.
// A +1 run park shifts the home team's win prob by roughly +2.5–3% (empirical).
// Direction: hitter park helps the home team slightly (familiarity + roster construction).
export function parkWinAdj(homeTeam) {
  const runFactor = getParkFactor(homeTeam);
  // Home team tends to be built for their park → slight additional edge in extreme parks
  return runFactor * 0.018;  // ≈ +2.6% per run of park factor, positive = home benefit
}
