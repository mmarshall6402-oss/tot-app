import { fetchMLBOdds } from "../../../lib/odds.js";
import { calculateEdge } from "../../../lib/edge.js";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
const cache = new Map();

const BET_THRESHOLD = 0.045; // 4.5% edge minimum

const LEAGUE = { WHIP: 1.30, K9: 8.5, ERA: 4.50 };

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
const num = (v, f) => (isNaN(+v) ? f : +v);

// WHIP lookup table — simple, no normalization needed
const whipScore = (w) =>
  w < 1.00 ? 1.6 :
  w < 1.10 ? 1.2 :
  w < 1.25 ? 0.6 :
  w < 1.40 ? 0.2 :
  w < 1.55 ? -0.3 :
  -0.7;

// ERA shrinkage: regress raw ERA toward league mean
// Prevents early-season sample distortion from generating fake edges
// Gallen at 4.45 ERA over 30 IP → shrunk to 4.47 (minimal change, close to league)
// Elite pitcher at 1.80 ERA over 80 IP → shrunk to 2.88 (still clearly good, not fake elite)
// Formula: adj_era = era * 0.60 + leagueERA * 0.40
// This kills the "20%+ edge because one pitcher has a 6.5 ERA in April" problem
const shrinkERA = (era) => era * 0.60 + LEAGUE.ERA * 0.40;

// ERA legitimacy: low ERA only trusted if K9 backs it up
// Applied AFTER shrinkage so the bonus is on the stabilized value
const eraBonus = (era, k9) => {
  const adjEra = shrinkERA(era);
  if (adjEra >= LEAGUE.ERA) return 0;
  const gap = (LEAGUE.ERA - adjEra) / LEAGUE.ERA;
  const credibility = Math.min(1.0, k9 / LEAGUE.K9);
  return gap * credibility * 0.15;
};

// Sample reliability: 1.0 at 60 IP, 0.33 at 0 IP
const conf = (ip) => Math.min(1, ip / 60);

// Park factors
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
// PITCHING SIGNAL
// ─────────────────────────────
const pitchSignal = (p) => {
  if (!p?.name || p.name === "TBD") return 0;
  const whip = num(p.whip, LEAGUE.WHIP);
  const k9   = num(p.k9 ?? p.strikeoutsPer9, LEAGUE.K9);
  const era  = num(p.era, LEAGUE.ERA);
  const ip   = num(p.inningsPitched, 40);
  const base = whipScore(whip) + eraBonus(era, k9);
  const k9Mult = Math.min(1.15, Math.max(0.85, k9 / LEAGUE.K9));
  return base * k9Mult * conf(ip);
};

// ─────────────────────────────
// PROBABILITY MODEL
// ─────────────────────────────
const computeProb = (g, m) => {
  const hp = m.homePitcher || {};
  const ap = m.awayPitcher || {};
  const hOps  = num(m.homeForm?.ops, 0.720);
  const aOps  = num(m.awayForm?.ops, 0.720);
  const hBull = num(m.homeBullpen?.era, 4.2);
  const aBull = num(m.awayBullpen?.era, 4.2);

  const pitchDiff = pitchSignal(hp) - pitchSignal(ap);

  // Elite dampener: large pitch gap → reduce offense weight
  const eliteFactor = Math.min(1.0, Math.abs(pitchDiff) / 1.5);
  const offWeight   = 0.22 * (1.0 - 0.30 * eliteFactor);

  // Rockies road penalty: Coors inflates their home OPS ~15-20%
      // Subtract from away OPS when Rockies are visiting
      const isRockiesAway = (g.awayTeam || '').toLowerCase().includes('rock') || 
                            (g.awayTeam || '').toLowerCase().includes('colorado');
      const isRockiesHome = (g.homeTeam || '').toLowerCase().includes('rock') ||
                            (g.homeTeam || '').toLowerCase().includes('colorado');
      const adjAwayOps = isRockiesAway ? aOps - 0.060 : aOps;
      const adjHomeOps = isRockiesHome ? hOps - 0.060 : hOps;
      const offense    = (adjHomeOps - adjAwayOps) * offWeight;
  const bullpen    = Math.max(-0.08, Math.min(0.08, (aBull - hBull) * 0.07));
  const volatility = Math.abs(pitchDiff) * 0.06;
  const homefield  = 0.02;

  const raw = 0.5 + pitchDiff * 0.22 + offense + bullpen - volatility + homefield;
  return Math.max(0.25, Math.min(0.75, raw));
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

const isNoisy = (m) =>
  Math.max(num(m.homePitcher?.whip, LEAGUE.WHIP), num(m.awayPitcher?.whip, LEAGUE.WHIP)) > 1.55 ||
  num(m.homePitcher?.inningsPitched, 40) < 20 ||
  num(m.awayPitcher?.inningsPitched, 40) < 20;

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
// EXPLAIN (Claude haiku — batched to avoid rate limits)
// ─────────────────────────────
async function explain(g, m, pick, edge, isBet, chaos) {
  const hp = m.homePitcher;
  const ap = m.awayPitcher;
  const fmtP = (p) => p?.name && p.name !== "TBD"
    ? `${p.name} (${p.era} ERA, ${p.whip} WHIP, ${p.strikeoutsPer9 || "—"} K/9)`
    : "TBD";

  const prompt = `Sharp MLB analyst. Pick: ${pick} (${isBet ? "BET" : "PASS"}, ${edge.toFixed(1)}% edge).
Game: ${g.awayTeam} @ ${g.homeTeam}
Home SP: ${fmtP(hp)} | Away SP: ${fmtP(ap)}
Home offense (last 10): ${m.homeForm?.avg || "—"} AVG, ${m.homeForm?.ops || "—"} OPS
Away offense (last 10): ${m.awayForm?.avg || "—"} AVG, ${m.awayForm?.ops || "—"} OPS
Home bullpen: ${m.homeBullpen?.era || "—"} ERA | Away bullpen: ${m.awayBullpen?.era || "—"} ERA
${chaos ? `Chaos flag: ${chaos}` : ""}

Lead with the single biggest edge factor. Use specific stats. Be honest about uncertainty.
JSON only: {"preview":"2 sentences","what_decides":"1 sentence","what_to_sweat":"1 sentence","honest_lean":"1 sentence","score_range":"e.g. 3-2"}`;

  try {
    // 8 second timeout — don't let slow API calls block the whole response
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 300,
        messages: [{ role: "user", content: prompt }],
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

    // Fallback: if Claude didn't return a preview, build one from raw stats
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

// Batch explain calls: run N at a time with a small delay between batches
// Prevents hitting Haiku rate limits when slate has 15 games
async function explainBatched(items, batchSize = 5, delayMs = 300) {
  const results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(({ g, m, pick, rawEdge, isBet, chaos }) =>
        explain(g, m, pick, rawEdge * 100, isBet, chaos)
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

    // Model pass (pure math, no AI)
    const modeled = unique.map(g => {
      const m = mlbGames.find(x => {
        const hw = g.homeTeam.split(" ").pop().toLowerCase();
        const aw = g.awayTeam.split(" ").pop().toLowerCase();
        return x.homeTeam?.toLowerCase().includes(hw) &&
               x.awayTeam?.toLowerCase().includes(aw);
      }) || {};

      const pf    = parkFactor(g.homeTeam);
      const chaos = chaosGate(g, m, pf);
      const noisy = isNoisy(m);
      const pfAdj = typeof pf === "number" ? (1.0 - pf) * 0.06 : 0;

      const homeProb = chaos
        ? Math.max(0.25, Math.min(0.75, 0.5 + pfAdj))
        : Math.max(0.25, Math.min(0.75, computeProb(g, m) + pfAdj));

      const homeEdge = calculateEdge(homeProb, g.homeImplied);
      const awayEdge = calculateEdge(1 - homeProb, g.awayImplied);
      const pickHome = homeEdge >= awayEdge;
      // Hard cap: real MLB edges don't exceed ~12-14%
      // Anything above = model overconfidence, not real market inefficiency
      const rawEdge  = Math.min(0.14, pickHome ? homeEdge : awayEdge);

      // Coinflip gate: if pitching signals nearly identical, don't bet
      // Market edge in coinflip games comes from noise, not real signal
      const hSig = pitchSignal(m.homePitcher || {});
      const aSig = pitchSignal(m.awayPitcher || {});
      const isCoinflip = Math.abs(hSig - aSig) < 0.12 && !chaos;

      const isBet    = rawEdge >= BET_THRESHOLD && !chaos && !noisy && !isCoinflip;
      const tier     = tierLabel(rawEdge, noisy, chaos);

      return { g, m, pick: pickHome ? g.homeTeam : g.awayTeam, rawEdge, isBet, tier, chaos, noisy };
    }).filter(Boolean);

    // Only explain games worth explaining:
    // - All BET games (users will read these carefully)
    // - Top 5 PASS games by edge (for context)
    // - Skip Tossup PASS games (nobody needs an explanation for "flip a coin")
    const toExplain = modeled.map((item, i) => ({ ...item, _idx: i }));
    const bets  = toExplain.filter(x => x.isBet);
    const passes = toExplain.filter(x => !x.isBet && x.tier?.level !== "Tossup").slice(0, 5);
    const skip  = toExplain.filter(x => !x.isBet && x.tier?.level === "Tossup");

    const explainQueue = [...bets, ...passes];
    const explanationMap = new Map();

    // Explain in batches
    const batchedResults = await explainBatched(explainQueue);
    explainQueue.forEach((item, i) => explanationMap.set(item._idx, batchedResults[i]));

    // Tossup skips get minimal breakdown
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

    const results = modeled.map(({ g, m, pick, rawEdge, isBet, tier, chaos }, i) => ({
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
      breakdown:    explanations[i],
      liveScore:    m.status ? {
        status:     m.status,
        homeScore:  m.homeScore,
        awayScore:  m.awayScore,
        inning:     m.inning,
        inningHalf: m.inningHalf,
      } : null,
    }));

    results.sort((a, b) => {
      if (a.isBet !== b.isBet) return a.isBet ? -1 : 1;
      return (b.edge || 0) - (a.edge || 0);
    });

    // MAX BETS PER SLATE: cap at 5 bets regardless of how many clear the threshold
    // Sharp systems pick fewer, higher-confidence spots. 10-12 bets/day = noise.
    // Games 6+ get isBet=false but keep their edge/tier for reference.
    let betCount = 0;
    for (const r of results) {
      if (r.isBet) {
        betCount++;
        if (betCount > 5) r.isBet = false;
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
