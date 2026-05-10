import { fetchMLBOdds } from "../../../lib/odds.js";
import { calculateEdge } from "../../../lib/edge.js";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
const cache = new Map();

const BET_THRESHOLD = 0.045; // 4.5% edge minimum
const MAX_BETS = 5;
const LEAGUE = { WHIP: 1.30, K9: 8.5, ERA: 4.50, BULL_ERA: 4.20 };

// ─────────────────────────────
// CACHE
// ─────────────────────────────
const getCached = async (key, fn, ttl = 1000 * 60 * 15) => {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.time < ttl) return hit.data;
  const data = await fn();
  cache.set(key, { data, time: Date.now() });
  return data;
};

// ─────────────────────────────
// HELPERS
// ─────────────────────────────
const num  = (v, f) => (isNaN(+v) ? f : +v);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ─────────────────────────────
// TEAM IDENTITY LAYER
// Hard baselines so bad teams can't hide behind one good pitcher.
// Scale: points relative to league-average 0. Range: roughly -4 to +4.
// ─────────────────────────────
const TEAM_RATING = {
  // Elite
  dodgers:     4,
  phillies:    3,
  astros:      3,
  braves:      3,
  yankees:     2,
  mets:        2,
  cubs:        2,
  "red sox":   2,
  guardians:   2,
  // Above average
  padres:      2,
  brewers:     1,
  orioles:     1,
  mariners:    1,
  rays:         2,
  cardinals:   -1,
  diamondbacks: 0,
  rangers:     1,
  twins:       1,
  // Below average
  giants:     -1,
  angels:     -1,
  pirates:    -1,
  reds:       -1,
  // Bad
  royals:     -2,
  tigers:     -2,
  marlins:    -2,
  nationals:  -2,
  // Terrible
  athletics:  -3,
  "white sox":-3,
  rockies:    -4, // also chaos gated away but belt + suspenders
};

const teamRating = (name) => {
  if (!name) return 0;
  const n = name.toLowerCase();
  for (const [key, val] of Object.entries(TEAM_RATING)) {
    if (n.includes(key)) return val;
  }
  return 0;
};

// Road penalty: bad teams get extra penalty on the road
const roadPenalty = (name) => {
  const r = teamRating(name);
  if (r <= -3) return 1.5;
  if (r <= -1) return 0.5;
  return 0;
};

// ─────────────────────────────
// PARK FACTORS
// ─────────────────────────────
const parkFactor = (homeTeam) => {
  const t = (homeTeam || "").toLowerCase();
  if (t.includes("rockies") || t.includes("colorado")) return "coors";
  if (t.includes("red sox") || t.includes("boston"))   return 1.06;
  if (t.includes("yankees"))                            return 1.04;
  if (t.includes("padres") || t.includes("san diego")) return 0.92;
  if (t.includes("mariners") || t.includes("seattle")) return 0.93;
  return 1.0;
};

// ─────────────────────────────
// STARTER EDGE  (clamped -3 to 3)
// This is the key fix: WHIP alone can no longer drive a 14% edge.
// ─────────────────────────────
const whipScore = (w) =>
  w < 1.00 ?  1.6 :
  w < 1.10 ?  1.2 :
  w < 1.25 ?  0.6 :
  w < 1.40 ?  0.2 :
  w < 1.55 ? -0.3 :
  -0.7;

const shrinkERA  = (era) => era * 0.60 + LEAGUE.ERA * 0.40;
const conf       = (ip)  => Math.min(1, ip / 60);

const eraBonus = (era, k9) => {
  const adj = shrinkERA(era);
  if (adj >= LEAGUE.ERA) return 0;
  const gap  = (LEAGUE.ERA - adj) / LEAGUE.ERA;
  const cred = Math.min(1.0, k9 / LEAGUE.K9);
  return gap * cred * 0.15;
};

const pitchSignalRaw = (p) => {
  if (!p?.name || p.name === "TBD") return 0;
  const whip = num(p.whip, LEAGUE.WHIP);
  const k9   = num(p.k9 ?? p.strikeoutsPer9, LEAGUE.K9);
  const era  = num(p.era, LEAGUE.ERA);
  const ip   = num(p.inningsPitched, 40);
  const base = whipScore(whip) + eraBonus(era, k9);
  const k9m  = clamp(k9 / LEAGUE.K9, 0.85, 1.15);
  return base * k9m * conf(ip);
};

// CLAMPED — this is what actually fixes the overconfidence bug
const pitchSignal = (p) => clamp(pitchSignalRaw(p), -3, 3);

// ─────────────────────────────
// V2 SCORING ENGINE
// score = starterEdge*0.25 + teamStrength*0.30 + bullpenEdge*0.20
//       + offenseEdge*0.15 + contextPenalty*0.10
// Output: probability [0.25, 0.75]
// ─────────────────────────────
const computeProb = (g, m) => {
  const hp = m.homePitcher || {};
  const ap = m.awayPitcher || {};

  // --- 1. STARTER EDGE (25%) ---
  const hSig = pitchSignal(hp);
  const aSig = pitchSignal(ap);
  const pitchDiff = hSig - aSig; // clamped per-side so max diff is ±6, typical ±2
  const starterEdge = pitchDiff; // used in weighted sum below

  // --- 2. TEAM STRENGTH (30%) ---
  const hRating = teamRating(g.homeTeam);
  const aRating = teamRating(g.awayTeam) - roadPenalty(g.awayTeam);
  // normalize to probability-space contribution: each point ≈ 1.5% win prob
  const teamStrength = (hRating - aRating) * 0.015;

  // --- 3. BULLPEN EDGE (20%) ---
  const hBull = num(m.homeBullpen?.era, LEAGUE.BULL_ERA);
  const aBull = num(m.awayBullpen?.era, LEAGUE.BULL_ERA);
  // better bullpen (lower ERA) helps home team
  const bullpenEdge = clamp((aBull - hBull) * 0.07, -0.06, 0.06);

  // --- 4. OFFENSE EDGE (15%) ---
  let hOps = num(m.homeForm?.ops, 0.720);
  let aOps = num(m.awayForm?.ops, 0.720);
  // Coors penalty on road OPS — their home splits are badly inflated
  if (/rockies|colorado/i.test(g.awayTeam || "")) aOps -= 0.060;
  if (/rockies|colorado/i.test(g.homeTeam || "")) hOps -= 0.060;
  // Elite starters suppress offense — reduce weight when big gap
  const eliteFactor = clamp(Math.abs(pitchDiff) / 1.5, 0, 1);
  const offWeight   = 0.22 * (1 - 0.30 * eliteFactor);
  const offenseEdge = (hOps - aOps) * offWeight;

  // --- 5. CONTEXT PENALTY (10%) ---
  // Run differential as quality signal
  const hG      = Math.max(1, (m.homeStandings?.wins || 0) + (m.homeStandings?.losses || 0));
  const aG      = Math.max(1, (m.awayStandings?.wins || 0) + (m.awayStandings?.losses || 0));
  const hRd     = (m.homeStandings?.runDifferential || 0) / hG;
  const aRd     = (m.awayStandings?.runDifferential || 0) / aG;
  const contextPenalty = clamp((hRd - aRd) * 0.008, -0.04, 0.04);

  // --- WEIGHTED SUM ---
  const raw =
    0.50 +                           // baseline
    starterEdge  * 0.055 +          // 25% weight scaled to prob-space
    teamStrength * 0.30 +            // 30% weight
    bullpenEdge  * 0.20 +            // 20% weight (already clamped ±0.06)
    offenseEdge  * 0.15 +            // 15% weight
    contextPenalty * 0.10 +          // 10% weight
    0.02;                            // home field

  // HARD CAP: real MLB edges don't produce 75% win probs often
  return clamp(raw, 0.28, 0.72);
};

// ─────────────────────────────
// CONFLICT DETECTION
// Signals pointing different directions → downgrade or PASS
// ─────────────────────────────
const detectConflict = (g, m, pickHome) => {
  const hp = m.homePitcher || {};
  const ap = m.awayPitcher || {};
  const hSig = pitchSignal(hp);
  const aSig = pitchSignal(ap);
  const pitchFavorsHome = hSig > aSig;

  const hOps  = num(m.homeForm?.ops, 0.720);
  const aOps  = num(m.awayForm?.ops, 0.720);
  const offFavorsHome = hOps > aOps;

  const hRating = teamRating(g.homeTeam);
  const aRating = teamRating(g.awayTeam);
  const teamFavorsHome = hRating >= aRating;

  // Count how many signals agree with the pick
  const signals = [pitchFavorsHome, offFavorsHome, teamFavorsHome];
  const agreeing = signals.filter(s => s === pickHome).length;

  // 0/3 or 1/3 signals agree = high conflict
  if (agreeing === 0) return "all signals conflict";
  if (agreeing === 1) return "majority signals conflict";
  return null; // 2/3 or 3/3 — acceptable
};

// ─────────────────────────────
// CHAOS GATE
// ─────────────────────────────
const chaosGate = (g, m, pf) => {
  if (pf === "coors") return "Coors Field";

  const hKnown = !!(m.homePitcher?.name && m.homePitcher.name !== "TBD");
  const aKnown = !!(m.awayPitcher?.name && m.awayPitcher.name !== "TBD");
  if (!hKnown && !aKnown) return "both starters TBD";

  const hWhip = num(m.homePitcher?.whip, LEAGUE.WHIP);
  const aWhip = num(m.awayPitcher?.whip, LEAGUE.WHIP);
  if (hWhip > 1.65 && aWhip > 1.65) return "both high-WHIP chaos";

  return null;
};

// ─────────────────────────────
// NO-BET SUPPRESSOR
// ─────────────────────────────
const noBetCheck = (g, m, rawEdge, pickHome) => {
  // Edge too small
  if (rawEdge < BET_THRESHOLD) return "edge below threshold";

  const hWhip = num(m.homePitcher?.whip, LEAGUE.WHIP);
  const aWhip = num(m.awayPitcher?.whip, LEAGUE.WHIP);
  const hIp   = num(m.homePitcher?.inningsPitched, 40);
  const aIp   = num(m.awayPitcher?.inningsPitched, 40);

  if (Math.max(hWhip, aWhip) > 1.55) return "high-WHIP starter";
  if (Math.min(hIp, aIp) < 15)       return "small sample";

  // Pitching coinflip — signals too close
  const hSig = pitchSignal(m.homePitcher || {});
  const aSig = pitchSignal(m.awayPitcher || {});
  if (Math.abs(hSig - aSig) < 0.12)  return "pitching coinflip";

  // CONFLICT CHECK — new in V2
  const conflict = detectConflict(g, m, pickHome);
  if (conflict) return conflict;

  return null;
};

// ─────────────────────────────
// TIER LABEL
// ─────────────────────────────
const tierLabel = (edge, noisy, chaos) => {
  if (chaos) return { level: "Tossup", label: "🎲 Toss-Up", emoji: "🎲" };
  const e =
    edge >= 0.10 ? "High"   :
    edge >= 0.06 ? "Medium" :
    edge >= 0.02 ? "Low"    : "Tossup";
  const capped = (noisy && e === "High") ? "Medium" : e;
  return {
    High:   { level: "High",   label: "🔥 Value Pick", emoji: "🔥" },
    Medium: { level: "Medium", label: "✅ Solid Pick", emoji: "✅" },
    Low:    { level: "Low",    label: "👀 Lean",       emoji: "👀" },
    Tossup: { level: "Tossup", label: "🎲 Toss-Up",   emoji: "🎲" },
  }[capped];
};

// ─────────────────────────────
// EXPLAIN  (Claude Haiku — batched)
// ─────────────────────────────
async function explain(g, m, pick, edge, isBet, chaos, conflict) {
  const hp = m.homePitcher;
  const ap = m.awayPitcher;
  const fmtP = (p) => p?.name && p.name !== "TBD"
    ? `${p.name} (${p.era} ERA, ${p.whip} WHIP, ${p.strikeoutsPer9 || "—"} K/9)`
    : "TBD";

  const hRating = teamRating(g.homeTeam);
  const aRating = teamRating(g.awayTeam);

  const prompt = `Sharp MLB analyst. Pick: ${pick} (${isBet ? "BET" : "PASS"}, ${edge.toFixed(1)}% edge).
Game: ${g.awayTeam} @ ${g.homeTeam}
Home SP: ${fmtP(hp)} | Away SP: ${fmtP(ap)}
Home offense (last 10): ${m.homeForm?.avg || "—"} AVG, ${m.homeForm?.ops || "—"} OPS
Away offense (last 10): ${m.awayForm?.avg || "—"} AVG, ${m.awayForm?.ops || "—"} OPS
Home bullpen: ${m.homeBullpen?.era || "—"} ERA | Away bullpen: ${m.awayBullpen?.era || "—"} ERA
Team ratings: ${g.homeTeam} ${hRating > 0 ? "+" : ""}${hRating} | ${g.awayTeam} ${aRating > 0 ? "+" : ""}${aRating}
${chaos ? `Chaos flag: ${chaos}` : ""}${conflict ? `\nConflict: ${conflict}` : ""}

Lead with the single biggest edge factor. Use specific stats. Be honest about uncertainty.
JSON only: {"preview":"2 sentences","what_decides":"1 sentence","what_to_sweat":"1 sentence","honest_lean":"1 sentence","score_range":"e.g. 3-2"}`;

  try {
    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), 8000);

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type":    "application/json",
        "x-api-key":       process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model:      "claude-haiku-4-5-20251001",
        max_tokens: 300,
        messages:   [{ role: "user", content: prompt }],
      }),
    });
    clearTimeout(timeout);

    const data  = await res.json();
    const text  = data.content?.[0]?.text || "{}";
    const clean = text.replace(/```json|```/g, "").trim();
    let bd = {};
    try { bd = JSON.parse(clean); } catch {
      const m2 = clean.match(/\{[\s\S]*\}/);
      if (m2) { try { bd = JSON.parse(m2[0]); } catch {} }
    }
    bd.pitcher_home = fmtP(hp);
    bd.pitcher_away = fmtP(ap);

    if (!bd.preview) {
      const hWhip = hp?.whip ? `${hp.whip} WHIP` : null;
      const aWhip = ap?.whip ? `${ap.whip} WHIP` : null;
      if (hWhip && aWhip) {
        bd.preview = `${g.homeTeam} starter (${hWhip}) vs ${g.awayTeam} starter (${aWhip}). Model picks ${pick} based on pitching and lineup edge.`;
      }
    }
    return bd;
  } catch {
    const fallbackPreview = hp?.whip && ap?.whip
      ? `${g.homeTeam} (${hp.whip} WHIP) vs ${g.awayTeam} (${ap.whip} WHIP). Take ${pick}.`
      : null;
    return {
      pitcher_home: fmtP(hp),
      pitcher_away: fmtP(ap),
      ...(fallbackPreview ? { preview: fallbackPreview } : {}),
    };
  }
}

async function explainBatched(items, batchSize = 5, delayMs = 300) {
  const results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(({ g, m, pick, rawEdge, isBet, chaos, conflict }) =>
        explain(g, m, pick, rawEdge * 100, isBet, chaos, conflict)
      )
    );
    results.push(...batchResults);
    if (i + batchSize < items.length) {
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  return results;
}

// ─────────────────────────────
// MAIN
// ─────────────────────────────
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

    // Dedup
    const seenKeys = new Set();
    const unique = oddsGames.filter(g => {
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

      // EDGE CAP: real MLB edges don't exceed ~12%
      const rawEdge = clamp(pickHome ? homeEdge : awayEdge, 0, 0.12);

      const conflict    = !chaos ? detectConflict(g, m, pickHome) : null;
      const noBetReason = chaos || noBetCheck(g, m, rawEdge, pickHome);
      const noisy       = !chaos && !!noBetReason;
      const tier        = tierLabel(rawEdge, noisy, chaos);
      const isBet       = !noBetReason && ["High","Medium"].includes(tier?.level);

      return { g, m, pick: pickHome ? g.homeTeam : g.awayTeam, rawEdge, isBet, tier, chaos, noisy, noBetReason, conflict };
    }).filter(Boolean);

    // ── EXPLAIN PASS (AI) ──
    const toExplain = modeled.map((item, i) => ({ ...item, _idx: i }));
    const bets   = toExplain.filter(x => x.isBet);
    const passes = toExplain.filter(x => !x.isBet && x.tier?.level !== "Tossup").slice(0, 5);
    const skip   = toExplain.filter(x => !x.isBet && x.tier?.level === "Tossup");

    const explainQueue   = [...bets, ...passes];
    const explanationMap = new Map();

    const batchedResults = await explainBatched(explainQueue);
    explainQueue.forEach((item, i) => explanationMap.set(item._idx, batchedResults[i]));

    skip.forEach(item => {
      explanationMap.set(item._idx, {
        pitcher_home: item.m.homePitcher?.name
          ? `${item.m.homePitcher.name} (${item.m.homePitcher.era} ERA, ${item.m.homePitcher.whip} WHIP)`
          : "TBD",
        pitcher_away: item.m.awayPitcher?.name
          ? `${item.m.awayPitcher.name} (${item.m.awayPitcher.era} ERA, ${item.m.awayPitcher.whip} WHIP)`
          : "TBD",
        preview: item.chaos
          ? `${item.chaos} — high variance game, model confidence is low.`
          : null,
      });
    });

    const explanations = modeled.map((_, i) => explanationMap.get(i) || {});

    // ── BUILD RESULTS ──
    const results = modeled.map(({ g, m, pick, rawEdge, isBet, tier, chaos, conflict, noBetReason }, i) => ({
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
      breakdown:    explanations[i],
      liveScore:    m.status ? {
        status:     m.status,
        homeScore:  m.homeScore,
        awayScore:  m.awayScore,
        inning:     m.inning,
        inningHalf: m.inningHalf,
      } : null,
    }));

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

    // Snapshot on bust
    if (searchParams.get("bust") && process.env.ADMIN_KEY) {
      fetch(`${BASE_URL}/api/admin/tracker`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-key": process.env.ADMIN_KEY },
        body: JSON.stringify({ action: "snapshot", picks: results, date }),
      }).catch(() => {});
    }

    return Response.json({ picks: results });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
