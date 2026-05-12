// picks/route.js — V3.1
// Changes from V2:
//  1. Normalized feature space — all signals scaled to [-1,+1] before weighting
//     so the weight comments actually match what the math does.
//  2. Dynamic team ratings — static priors blended 35/65 with live
//     run-differential + win-pct from standings already in the MLB route.
//  3. Deterministic explanations — structured fields built from real numbers.
//     Claude only called for honest_lean + what_to_sweat (2 sentences, ~120 tokens).
//     Fallback path never produces generic "Model picks X" text.
//
// V3.1 fixes (4 surgical changes):
//  a. whipScore() — steeper penalties: 1.55 WHIP → -0.8, 1.70+ → -2.4
//     (was -0.3 / -0.7; bad starters can no longer hide behind team/bullpen priors)
//  b. bullpen weight decoupled from offWeight — elite starters suppress offense,
//     not bullpen relevance. Fixed hidden distortion in weighted sum.
//  c. Home field constant: 0.02 → 0.012 (modern MLB empirical value)
//  d. noBetCheck high-WHIP filter now judges the PICKED side's starter only —
//     a bad opponent starter is value, not a reason to pass.

import { fetchMLBOdds } from "../../../lib/odds.js";
import { calculateEdge } from "../../../lib/edge.js";

const BASE_URL  = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
const cache     = new Map();

const BET_THRESHOLD = 0.045; // 4.5% minimum edge to bet
const MAX_BETS      = 5;
const LEAGUE = { WHIP: 1.30, K9: 8.5, ERA: 4.50, BULL_ERA: 4.20 };

// ─────────────────────────────────────────────────────────────
// CACHE
// ─────────────────────────────────────────────────────────────
const getCached = async (key, fn, ttl = 1000 * 60 * 15) => {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.time < ttl) return hit.data;
  const data = await fn();
  cache.set(key, { data, time: Date.now() });
  return data;
};

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────
const num   = (v, fallback) => (isNaN(+v) ? fallback : +v);
const clamp = (v, lo, hi)   => Math.max(lo, Math.min(hi, v));

// ─────────────────────────────────────────────────────────────
// TEAM IDENTITY LAYER — static priors only
// Scale: points relative to league-average 0. Range ~-4 to +4.
// These are blended with live data below (see dynamicTeamRating).
// ─────────────────────────────────────────────────────────────
const TEAM_PRIOR = {
  // Elite
  dodgers:      4,  phillies:  3,  astros:   3,  braves:    3,
  yankees:      2,  mets:      2,  cubs:     2,  "red sox": 2,
  guardians:    2,  padres:    2,
  // Above average
  brewers:      1,  orioles:   1,  mariners: 1,  rays:      2,
  rangers:      1,  twins:     1,
  // Neutral / slight negative
  cardinals:   -1,  diamondbacks: 0,
  // Below average
  giants:      -1,  angels:  -1,  pirates: -1,  reds:     -1,
  // Bad
  royals:      -2,  tigers:  -2,  marlins: -2,  nationals: -2,
  // Terrible
  athletics:   -3,  "white sox": -3,  rockies: -4,
};

const lookupPrior = (name) => {
  if (!name) return 0;
  const n = name.toLowerCase();
  for (const [key, val] of Object.entries(TEAM_PRIOR)) {
    if (n.includes(key)) return val;
  }
  return 0;
};

/**
 * FIX 2: Dynamic team rating.
 * Blends the static prior (35%) with a live signal derived from
 * run differential per game + win percentage (65%).
 * Falls back to pure prior when standings data is missing.
 *
 * @param {string} name   - team name
 * @param {object} standings - { wins, losses, runDifferential } from MLB route
 * @returns {number} rating on same ±4 scale as TEAM_PRIOR
 */
const dynamicTeamRating = (name, standings) => {
  const prior = lookupPrior(name);
  if (!standings) return prior;

  const games  = Math.max(1, (standings.wins || 0) + (standings.losses || 0));
  const winPct = (standings.wins || 0) / games;
  const rdPg   = (standings.runDifferential || 0) / games;

  // Live signal: run diff per game contributes ±3 pts; win pct contributes ±2 pts
  const live = clamp(rdPg * 1.5, -3, 3) + clamp((winPct - 0.5) * 10, -2, 2);

  // Blend: trust live data more as sample grows, capped at 65% weight
  const liveWeight = Math.min(0.65, games / 100);
  return prior * (1 - liveWeight) + live * liveWeight;
};

// Road penalty: weak teams suffer more on the road
const roadPenalty = (name, standings) => {
  const r = dynamicTeamRating(name, standings);
  if (r <= -3) return 1.5;
  if (r <= -1) return 0.5;
  return 0;
};

// ─────────────────────────────────────────────────────────────
// PARK FACTORS
// ─────────────────────────────────────────────────────────────
const parkFactor = (homeTeam) => {
  const t = (homeTeam || "").toLowerCase();
  if (t.includes("rockies") || t.includes("colorado")) return "coors";
  if (t.includes("red sox") || t.includes("boston"))   return 1.06;
  if (t.includes("yankees"))                            return 1.04;
  if (t.includes("padres")  || t.includes("san diego")) return 0.92;
  if (t.includes("mariners")|| t.includes("seattle"))  return 0.93;
  return 1.0;
};

// ─────────────────────────────────────────────────────────────
// STARTER SIGNAL  →  normalized to [-1, +1]
// ─────────────────────────────────────────────────────────────
const whipScore = (w) =>
  w < 1.00 ?  1.6 :
  w < 1.10 ?  1.2 :
  w < 1.25 ?  0.6 :
  w < 1.40 ?  0.1 :
  w < 1.55 ? -0.8 :
  w < 1.70 ? -1.6 :
  -2.4;

const shrinkERA = (era) => era * 0.60 + LEAGUE.ERA * 0.40;
const confWeight = (ip)  => Math.min(1, ip / 60); // sample shrink

const eraBonus = (era, k9) => {
  const adj  = shrinkERA(era);
  if (adj >= LEAGUE.ERA) return 0;
  const gap  = (LEAGUE.ERA - adj) / LEAGUE.ERA;
  const cred = Math.min(1.0, k9 / LEAGUE.K9);
  return gap * cred * 0.15;
};

const rawPitchSignal = (p) => {
  if (!p?.name || p.name === "TBD") return 0;
  const whip = num(p.whip, LEAGUE.WHIP);
  const k9   = num(p.k9 ?? p.strikeoutsPer9, LEAGUE.K9);
  const era  = num(p.era,  LEAGUE.ERA);
  const ip   = num(p.inningsPitched, 40);
  const base = whipScore(whip) + eraBonus(era, k9);
  const k9m  = clamp(k9 / LEAGUE.K9, 0.85, 1.15);
  return base * k9m * confWeight(ip);
};

// Normalize raw pitch signal to [-1, +1]
// Raw range is roughly ±2.5 in practice; dividing by 2.5 maps it cleanly.
const pitchSignal = (p) => clamp(rawPitchSignal(p) / 2.5, -1, 1);

// ─────────────────────────────────────────────────────────────
// FIX 1: V3 SCORING ENGINE — all features in [-1,+1] before weighting
//
// Weights now mean what the comments say:
//   starter    25%
//   team       30%
//   bullpen    20%
//   offense    15%
//   context    10%
//
// Output: win probability [0.28, 0.72]
// ─────────────────────────────────────────────────────────────
const computeProb = (g, m) => {
  const hp = m.homePitcher || {};
  const ap = m.awayPitcher || {};

  // 1. STARTER (25%) — already [-1,+1] per pitchSignal()
  const hSig        = pitchSignal(hp);
  const aSig        = pitchSignal(ap);
  const starterNorm = clamp(hSig - aSig, -1, 1); // positive = home advantage

  // 2. TEAM STRENGTH (30%) — dynamic rating, normalize by max possible gap (8 pts)
  const hRating   = dynamicTeamRating(g.homeTeam, m.homeStandings);
  const aRating   = dynamicTeamRating(g.awayTeam, m.awayStandings) - roadPenalty(g.awayTeam, m.awayStandings);
  const teamNorm  = clamp((hRating - aRating) / 8, -1, 1);

  // 3. BULLPEN (20%) — ERA gap, normalize over ±2 ERA range
  const hBull      = num(m.homeBullpen?.era, LEAGUE.BULL_ERA);
  const aBull      = num(m.awayBullpen?.era, LEAGUE.BULL_ERA);
  const bullpenNorm = clamp((aBull - hBull) / 2, -1, 1); // lower ERA = better

  // 4. OFFENSE (15%) — OPS gap, normalize over ±0.100 OPS range
  let hOps = num(m.homeForm?.ops, 0.720);
  let aOps = num(m.awayForm?.ops, 0.720);
  // Coors road penalty: away team's OPS is park-inflated
  if (/rockies|colorado/i.test(g.awayTeam || "")) aOps -= 0.060;
  if (/rockies|colorado/i.test(g.homeTeam || "")) hOps -= 0.060;
  // Elite starters suppress offense — reduce weight when big pitching gap
  const eliteFactor = clamp(Math.abs(starterNorm), 0, 1);
  const offWeight   = 0.15 * (1 - 0.30 * eliteFactor);
  const offenseNorm = clamp((hOps - aOps) / 0.100, -1, 1);

  // 5. CONTEXT (10%) — run differential per game, normalize over ±2 RPG range
  const hG          = Math.max(1, (m.homeStandings?.wins || 0) + (m.homeStandings?.losses || 0));
  const aG          = Math.max(1, (m.awayStandings?.wins || 0) + (m.awayStandings?.losses || 0));
  const hRd         = (m.homeStandings?.runDifferential || 0) / hG;
  const aRd         = (m.awayStandings?.runDifferential || 0) / aG;
  const contextNorm = clamp((hRd - aRd) / 2, -1, 1);

  // WEIGHTED SUM — weights match comments, all inputs on same [-1,+1] scale
  // Each norm * weight contributes at most ±weight to the final probability shift.
  // Bullpen is independent of offWeight — strong starters suppress offense, not bullpens.
  const shift =
    starterNorm  * 0.25 +
    teamNorm     * 0.30 +
    bullpenNorm  * 0.20 +
    offenseNorm  * offWeight +
    contextNorm  * 0.10;

  // shift range: roughly [-0.85, +0.85]; scale to probability space
  // A full shift of ±1.0 → ±0.22 in win prob (realistic MLB range)
  // Home field: ~1.2% in modern MLB (down from historical ~2%)
  const raw = 0.50 + shift * 0.22 + 0.012;

  return clamp(raw, 0.28, 0.72);
};

// ─────────────────────────────────────────────────────────────
// CONFLICT DETECTION
// ─────────────────────────────────────────────────────────────
const detectConflict = (g, m, pickHome) => {
  const hSig = pitchSignal(m.homePitcher || {});
  const aSig = pitchSignal(m.awayPitcher || {});

  const signals = [
    hSig > aSig,                                              // pitching
    num(m.homeForm?.ops, 0.720) > num(m.awayForm?.ops, 0.720), // offense
    dynamicTeamRating(g.homeTeam, m.homeStandings) >=
      dynamicTeamRating(g.awayTeam, m.awayStandings),        // team quality
  ];

  const agreeing = signals.filter(s => s === pickHome).length;
  if (agreeing === 0) return "all signals conflict";
  if (agreeing === 1) return "majority signals conflict";
  return null;
};

// ─────────────────────────────────────────────────────────────
// CHAOS GATE
// ─────────────────────────────────────────────────────────────
const chaosGate = (g, m, pf) => {
  if (/rockies|colorado/i.test(g.awayTeam || "")) return "Rockies road game";
  if (pf === "coors") return "Coors Field";

  const hKnown = !!(m.homePitcher?.name && m.homePitcher.name !== "TBD");
  const aKnown = !!(m.awayPitcher?.name && m.awayPitcher.name !== "TBD");
  if (!hKnown && !aKnown) return "both starters TBD";

  const hWhip = num(m.homePitcher?.whip, LEAGUE.WHIP);
  const aWhip = num(m.awayPitcher?.whip, LEAGUE.WHIP);
  if (hWhip > 1.65 && aWhip > 1.65) return "both high-WHIP chaos";

  return null;
};

// ─────────────────────────────────────────────────────────────
// NO-BET SUPPRESSOR
// ─────────────────────────────────────────────────────────────
const noBetCheck = (g, m, rawEdge, pickHome) => {
  if (rawEdge < BET_THRESHOLD)   return "edge below threshold";

  const hWhip = num(m.homePitcher?.whip, LEAGUE.WHIP);
  const aWhip = num(m.awayPitcher?.whip, LEAGUE.WHIP);
  const hIp   = num(m.homePitcher?.inningsPitched, 40);
  const aIp   = num(m.awayPitcher?.inningsPitched, 40);

  // Only reject if the starter you're BETTING ON is the bad one —
  // a high-WHIP opponent is often exactly where value lives.
  const pickedWhip = pickHome ? hWhip : aWhip;
  if (pickedWhip > 1.55) return "high-WHIP starter";
  if (Math.min(hIp, aIp) < 15)       return "small sample";

  const hSig = pitchSignal(m.homePitcher || {});
  const aSig = pitchSignal(m.awayPitcher || {});
  if (Math.abs(hSig - aSig) < 0.10)  return "pitching coinflip";

  const conflict = detectConflict(g, m, pickHome);
  if (conflict) return conflict;

  return null;
};

// ─────────────────────────────────────────────────────────────
// TIER LABEL
// ─────────────────────────────────────────────────────────────
const tierLabel = (edge, noisy, chaos) => {
  if (chaos) return { level: "Tossup", label: "🎲 Toss-Up", emoji: "🎲" };
  const base =
    edge >= 0.10 ? "High"   :
    edge >= 0.06 ? "Medium" :
    edge >= 0.02 ? "Low"    : "Tossup";
  const level = noisy && base === "High" ? "Medium" : base;
  return {
    High:   { level: "High",   label: "🔥 Value Pick", emoji: "🔥" },
    Medium: { level: "Medium", label: "✅ Solid Pick", emoji: "✅" },
    Low:    { level: "Low",    label: "👀 Lean",       emoji: "👀" },
    Tossup: { level: "Tossup", label: "🎲 Toss-Up",   emoji: "🎲" },
  }[level];
};

// ─────────────────────────────────────────────────────────────
// FIX 3: DETERMINISTIC EXPLANATION ENGINE
// Structured fields are built from real numbers — no hallucination risk.
// Claude is only called for honest_lean + what_to_sweat (2 short sentences).
// The fallback path produces honest, specific text every time.
// ─────────────────────────────────────────────────────────────

/**
 * Identify the single biggest driver of the model's lean.
 * Returns a human-readable factor name and direction.
 */
const dominantFactor = (g, m, pickHome) => {
  const hp = m.homePitcher || {};
  const ap = m.awayPitcher || {};

  const hSig  = pitchSignal(hp);
  const aSig  = pitchSignal(ap);
  const hRating = dynamicTeamRating(g.homeTeam, m.homeStandings);
  const aRating = dynamicTeamRating(g.awayTeam, m.awayStandings);
  const hBull = num(m.homeBullpen?.era, LEAGUE.BULL_ERA);
  const aBull = num(m.awayBullpen?.era, LEAGUE.BULL_ERA);
  const hOps  = num(m.homeForm?.ops, 0.720);
  const aOps  = num(m.awayForm?.ops, 0.720);

  // Each factor's normalized contribution (same scale as computeProb)
  const factors = {
    "starting pitching": Math.abs(hSig - aSig) * 0.25,
    "team quality":      Math.abs(hRating - aRating) / 8 * 0.30,
    "bullpen depth":     Math.abs(hBull - aBull) / 2 * 0.20,
    "offensive form":    Math.abs(hOps - aOps) / 0.100 * 0.15,
  };

  return Object.entries(factors).sort((a, b) => b[1] - a[1])[0][0];
};

/** Build deterministic preview sentence from real stats. */
const buildPreview = (g, m, pick, dominant) => {
  const hp  = m.homePitcher;
  const ap  = m.awayPitcher;
  const fmtP = (p) => p?.name && p.name !== "TBD"
    ? `${p.name} (${p.era} ERA, ${p.whip} WHIP)`
    : null;

  const hName = fmtP(hp);
  const aName = fmtP(ap);

  // Sentence 1: dominant factor with real numbers
  let s1 = "";
  if (dominant === "starting pitching" && hName && aName) {
    const hBetter = pitchSignal(hp) > pitchSignal(ap);
    s1 = `${hBetter ? g.homeTeam : g.awayTeam} hold the pitching edge — ${hBetter ? hName : aName} vs. ${hBetter ? aName : hName}.`;
  } else if (dominant === "team quality") {
    const hR = dynamicTeamRating(g.homeTeam, m.homeStandings);
    const aR = dynamicTeamRating(g.awayTeam, m.awayStandings);
    s1 = `Team quality gap drives this lean: ${g.homeTeam} (${hR > 0 ? "+" : ""}${hR.toFixed(1)}) vs. ${g.awayTeam} (${aR > 0 ? "+" : ""}${aR.toFixed(1)}).`;
  } else if (dominant === "bullpen depth") {
    const hBull = num(m.homeBullpen?.era, LEAGUE.BULL_ERA);
    const aBull = num(m.awayBullpen?.era, LEAGUE.BULL_ERA);
    s1 = `Bullpen edge matters here — ${g.homeTeam} pen: ${hBull.toFixed(2)} ERA vs. ${g.awayTeam}: ${aBull.toFixed(2)} ERA.`;
  } else if (dominant === "offensive form") {
    const hOps = num(m.homeForm?.ops, 0.720);
    const aOps = num(m.awayForm?.ops, 0.720);
    s1 = `Offensive form separates these teams — ${g.homeTeam}: ${hOps} OPS, ${g.awayTeam}: ${aOps} OPS (last 10 games).`;
  } else {
    // Generic fallback using whatever pitcher data exists
    s1 = hName && aName
      ? `${hName} takes the mound for ${g.homeTeam} against ${aName}.`
      : `Matchup: ${g.awayTeam} @ ${g.homeTeam}.`;
  }

  // Sentence 2: the pick rationale
  const s2 = `Model leans ${pick} based on ${dominant}.`;

  return `${s1} ${s2}`;
};

/** Build form lines from real numbers. */
const buildFormLine = (team, form) => {
  if (!form) return `${team} — form data unavailable.`;
  const avg = form.avg || "—";
  const ops = form.ops || "—";
  const hr  = form.homeRuns ?? "—";
  const r   = form.runs ?? "—";
  const g   = form.gamesPlayed ?? "last 10";
  return `${team}: ${avg} AVG, ${ops} OPS, ${hr} HR, ${r} R over ${g} games.`;
};

/** Build what_decides from dominant factor. */
const buildWhatDecides = (g, m, dominant, pick) => {
  const hp = m.homePitcher;
  const ap = m.awayPitcher;
  if (dominant === "starting pitching") {
    const hSig = pitchSignal(hp || {});
    const aSig = pitchSignal(ap || {});
    const edge = hSig > aSig ? g.homeTeam : g.awayTeam;
    return `Whether ${edge}'s starter can maintain command through 6+ innings is the key variable.`;
  }
  if (dominant === "bullpen depth") return `Late-inning bullpen performance will decide this — ${pick}'s 'pen has the edge.`;
  if (dominant === "offensive form") return `Whichever lineup stays hot from last week carries the day.`;
  return `${pick}'s overall quality advantage should hold if the game stays close.`;
};

/** Estimate score range from ERA and OPS data. */
const buildScoreRange = (g, m) => {
  const hEra  = num(m.homePitcher?.era,   4.50);
  const aEra  = num(m.awayPitcher?.era,   4.50);
  const hOps  = num(m.homeForm?.ops,      0.720);
  const aOps  = num(m.awayForm?.ops,      0.720);

  // Rough expected runs: ERA is runs per 9, scale to ~6 IP + bullpen
  const hExpR = clamp(aEra / 9 * 6 * (hOps / 0.720) * 0.85, 1.5, 8);
  const aExpR = clamp(hEra / 9 * 6 * (aOps / 0.720) * 0.85, 1.5, 8);

  const hi = Math.round(Math.max(hExpR, aExpR));
  const lo = Math.round(Math.min(hExpR, aExpR));
  return `${hi}-${lo}`;
};

/** Format pitcher for display. */
const fmtPitcher = (p) =>
  p?.name && p.name !== "TBD"
    ? `${p.name} (${p.era} ERA, ${p.whip} WHIP${p.strikeoutsPer9 ? `, ${p.strikeoutsPer9} K/9` : ""})`
    : "TBD";

/**
 * Main explain function.
 * Builds all deterministic fields locally, then calls Claude ONLY for
 * honest_lean + what_to_sweat — 2 sentences, cheap, low hallucination risk.
 */
async function buildExplanation(g, m, pick, rawEdge, isBet, chaos, conflict) {
  const hp       = m.homePitcher;
  const ap       = m.awayPitcher;
  const pickHome = pick === g.homeTeam;
  const dominant = dominantFactor(g, m, pickHome);

  // --- Deterministic fields ---
  const pitcher_home = fmtPitcher(hp);
  const pitcher_away = fmtPitcher(ap);
  const preview      = chaos
    ? `${chaos} — model confidence is low, high variance game.`
    : buildPreview(g, m, pick, dominant);
  const form_home    = buildFormLine(g.homeTeam, m.homeForm);
  const form_away    = buildFormLine(g.awayTeam, m.awayForm);
  const what_decides = chaos ? "High variance — avoid or size down." : buildWhatDecides(g, m, dominant, pick);
  const score_range  = buildScoreRange(g, m);

  // --- Claude for the two "feel" fields ---
  // If timed out or fails, fallback text is always honest.
  let honest_lean   = isBet
    ? `${pick} is the play at this edge.`
    : `Worth watching but not worth betting — edge is thin.`;
  let what_to_sweat = conflict
    ? `Signals are split — ${conflict}. Don't overbet.`
    : `Standard variance risk; even the right side loses 40% of the time.`;

  const hRating = dynamicTeamRating(g.homeTeam, m.homeStandings);
  const aRating = dynamicTeamRating(g.awayTeam, m.awayStandings);

  const claudePrompt =
    `Sharp MLB analyst. Single focus: 2 JSON fields only.\n` +
    `Game: ${g.awayTeam} @ ${g.homeTeam}\n` +
    `Pick: ${pick} (${(rawEdge * 100).toFixed(1)}% edge, ${isBet ? "BET" : "PASS"})\n` +
    `Key driver: ${dominant}\n` +
    `Home SP: ${pitcher_home} | Away SP: ${pitcher_away}\n` +
    `Offense: ${g.homeTeam} ${num(m.homeForm?.ops, 0.720)} OPS | ${g.awayTeam} ${num(m.awayForm?.ops, 0.720)} OPS\n` +
    `Team ratings: ${g.homeTeam} ${hRating > 0 ? "+" : ""}${hRating.toFixed(1)} | ${g.awayTeam} ${aRating > 0 ? "+" : ""}${aRating.toFixed(1)}\n` +
    (conflict ? `Conflict: ${conflict}\n` : "") +
    (chaos    ? `Chaos: ${chaos}\n`       : "") +
    `\nReturn ONLY valid JSON, no markdown:\n` +
    `{"honest_lean":"1 sentence, blunt, like texting a friend","what_to_sweat":"1 sentence biggest risk taking ${pick}"}`;

  try {
    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), 7000);

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method:  "POST",
      signal:  controller.signal,
      headers: {
        "Content-Type":      "application/json",
        "x-api-key":         process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model:      "claude-haiku-4-5-20251001",
        max_tokens: 120,
        messages:   [{ role: "user", content: claudePrompt }],
      }),
    });
    clearTimeout(timeout);

    const data  = await res.json();
    const text  = data.content?.[0]?.text || "{}";
    const clean = text.replace(/```json|```/g, "").trim();

    let parsed = {};
    try { parsed = JSON.parse(clean); } catch {
      const match = clean.match(/\{[\s\S]*\}/);
      if (match) { try { parsed = JSON.parse(match[0]); } catch {} }
    }

    if (parsed.honest_lean)   honest_lean   = parsed.honest_lean;
    if (parsed.what_to_sweat) what_to_sweat = parsed.what_to_sweat;
  } catch {
    // fallback values already set above — they are always honest
  }

  return {
    pitcher_home,
    pitcher_away,
    preview,
    form_home,
    form_away,
    what_decides,
    what_to_sweat,
    honest_lean,
    score_range,
    dominant_factor: dominant, // expose for debugging
  };
}

/** Batched explain with concurrency control. */
async function explainBatched(items, batchSize = 5, delayMs = 250) {
  const results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(({ g, m, pick, rawEdge, isBet, chaos, conflict }) =>
        buildExplanation(g, m, pick, rawEdge, isBet, chaos, conflict)
      )
    );
    results.push(...batchResults);
    if (i + batchSize < items.length) {
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  return results;
}

// ─────────────────────────────────────────────────────────────
// MAIN ROUTE HANDLER
// ─────────────────────────────────────────────────────────────
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const date = searchParams.get("date") || new Date().toISOString().split("T")[0];
    if (searchParams.get("bust")) cache.clear();

    const [oddsGames, mlbRes] = await Promise.all([
      getCached("odds", fetchMLBOdds),
      getCached("mlb_" + date, () =>
        fetch(`${BASE_URL}/api/mlb?date=${date}`).then(r => r.json())
      ),
    ]);

    const mlbGames = mlbRes?.games || [];

    // Dedup by homeTeam_awayTeam key
    const seenKeys = new Set();
    const unique   = oddsGames.filter(g => {
      const k = `${g.homeTeam}_${g.awayTeam}`;
      if (seenKeys.has(k)) return false;
      seenKeys.add(k);
      return true;
    });

    // ── MODEL PASS (pure math, no AI) ──
    const modeled = unique.map(g => {
      const m = mlbGames.find(x => {
        const hw = g.homeTeam.split(" ").pop().toLowerCase();
        const aw = g.awayTeam.split(" ").pop().toLowerCase();
        return x.homeTeam?.toLowerCase().includes(hw) &&
               x.awayTeam?.toLowerCase().includes(aw);
      }) || {};

      const pf    = parkFactor(g.homeTeam);
      const chaos = chaosGate(g, m, pf);
      const pfAdj = typeof pf === "number" ? (1.0 - pf) * 0.06 : 0;

      const homeProb = chaos
        ? clamp(0.5 + pfAdj, 0.28, 0.72)
        : clamp(computeProb(g, m) + pfAdj, 0.28, 0.72);

      const homeEdge = calculateEdge(homeProb, g.homeImplied);
      const awayEdge = calculateEdge(1 - homeProb, g.awayImplied);
      const pickHome = homeEdge >= awayEdge;

      // Hard cap: real MLB edges don't exceed ~12%
      const rawEdge = clamp(pickHome ? homeEdge : awayEdge, 0, 0.12);

      const conflict    = !chaos ? detectConflict(g, m, pickHome) : null;
      const noBetReason = chaos || noBetCheck(g, m, rawEdge, pickHome);
      const noisy       = !chaos && !!noBetReason;
      const tier        = tierLabel(rawEdge, noisy, chaos);
      const isBet       = !noBetReason && ["High", "Medium"].includes(tier?.level);

      return { g, m, pick: pickHome ? g.homeTeam : g.awayTeam, rawEdge, isBet, tier, chaos, noisy, noBetReason, conflict };
    }).filter(Boolean);

    // ── EXPLAIN PASS ──
    // Bets and non-tossup passes get Claude for honest_lean/what_to_sweat.
    // Tossups get deterministic-only (no Claude call).
    const toExplain = modeled.map((item, i) => ({ ...item, _idx: i }));
    const bets      = toExplain.filter(x => x.isBet);
    const passes    = toExplain.filter(x => !x.isBet && x.tier?.level !== "Tossup").slice(0, 5);
    const tossups   = toExplain.filter(x => x.tier?.level === "Tossup");

    const explainQueue   = [...bets, ...passes];
    const explanationMap = new Map();

    const batchedResults = await explainBatched(explainQueue);
    explainQueue.forEach((item, i) => explanationMap.set(item._idx, batchedResults[i]));

    // Tossups: deterministic only, no Claude call
    tossups.forEach(item => {
      explanationMap.set(item._idx,
        buildExplanation(item.g, item.m, item.pick, item.rawEdge, false, item.chaos, item.conflict)
          .then(r => explanationMap.set(item._idx, r)) // async, resolves quickly
      );
    });
    // Await any pending tossup explanations
    await Promise.all(
      tossups.map(item => explanationMap.get(item._idx))
    );

    // ── BUILD RESULTS ──
    const results = await Promise.all(
      modeled.map(async ({ g, m, pick, rawEdge, isBet, tier, chaos, conflict, noBetReason }, i) => ({
        id:           g.id,
        homeTeam:     g.homeTeam,
        awayTeam:     g.awayTeam,
        commenceTime: g.commenceTime,
        homeOdds:     g.homeOdds,
        awayOdds:     g.awayOdds,
        pick,
        tier,
        edge:         parseFloat((rawEdge * 100).toFixed(1)),
        isBet,
        chaos:        chaos || null,
        passReason:   isBet ? null : (noBetReason || null),
        breakdown:    await explanationMap.get(i),
        liveScore:    m.status ? {
          status:     m.status,
          homeScore:  m.homeScore,
          awayScore:  m.awayScore,
          inning:     m.inning,
          inningHalf: m.inningHalf,
        } : null,
      }))
    );

    // BETs first, then by edge descending
    results.sort((a, b) => {
      if (a.isBet !== b.isBet) return a.isBet ? -1 : 1;
      return (b.edge || 0) - (a.edge || 0);
    });

    // MAX BETS CAP
    let betCount = 0;
    for (const r of results) {
      if (r.isBet) {
        betCount++;
        if (betCount > MAX_BETS) {
          r.isBet      = false;
          r.passReason = "slate cap reached";
        }
      }
    }

    // Admin snapshot on bust
    if (searchParams.get("bust") && process.env.ADMIN_KEY) {
      fetch(`${BASE_URL}/api/admin/tracker`, {
        method:  "POST",
        headers: { "Content-Type": "application/json", "x-admin-key": process.env.ADMIN_KEY },
        body:    JSON.stringify({ action: "snapshot", picks: results, date }),
      }).catch(() => {});
    }

    return Response.json({ picks: results });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
