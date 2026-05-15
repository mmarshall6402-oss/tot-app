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

// Run environment → win probability impact.
// A +1 run park shifts the home team's win prob by roughly +2.5–3% (empirical).
// Direction: hitter park helps the home team slightly (familiarity + roster construction).
export function parkWinAdj(homeTeam) {
  const runFactor = getParkFactor(homeTeam);
  // Home team tends to be built for their park → slight additional edge in extreme parks
  return runFactor * 0.018;  // ≈ +2.6% per run of park factor, positive = home benefit
}
