import { createClient } from "@supabase/supabase-js";
import { fetchMLBOdds } from "../../../lib/odds.js";
import { calculateEdge, BET_THRESHOLD, getConfidenceTier } from "../../../lib/edge.js";
import { getModelProbability } from "../../../lib/probability.js";
import { applyFilterLayer, buildParlayCards } from "../../../lib/filter.js";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const memCache = new Map();
const TTL = 1000 * 60 * 10;

const getMemCached = async (key, fn) => {
  const hit = memCache.get(key);
  if (hit && Date.now() - hit.time < TTL) return hit.data;
  const data = await fn();
  memCache.set(key, { data, time: Date.now() });
  return data;
};

function matchMLB(game, mlbGames) {
  return mlbGames.find(g => {
    const hw = game.homeTeam?.split(" ").pop()?.toLowerCase();
    const aw = game.awayTeam?.split(" ").pop()?.toLowerCase();
    return g.homeTeam?.toLowerCase().includes(hw) && g.awayTeam?.toLowerCase().includes(aw);
  });
}

async function callClaude(prompt) {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 600,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const data = await res.json();
    return data.content?.[0]?.text || "{}";
  } catch { return "{}"; }
}

async function processGame(game, mlbGames) {
  const mlb = matchMLB(game, mlbGames);

  // Synchronous: uses Elo + pre-fetched mlb data, no extra API calls
  const modelProb = getModelProbability(game, mlb);
  const rawEdge = calculateEdge(modelProb, game.homeImplied);
  // Positive rawEdge → home has value; negative → away has value
  const pick = rawEdge >= 0 ? game.homeTeam : game.awayTeam;
  const edgePct = Math.abs(rawEdge) * 100;
  const isBet = edgePct >= BET_THRESHOLD * 100;

  const homePitcher = mlb?.homePitcher;
  const awayPitcher = mlb?.awayPitcher;
  const hf = mlb?.homeForm;
  const af = mlb?.awayForm;
  const ipStr = (p) => p?.inningsPitched ? ` ${p.inningsPitched} IP` : "";
  const homePStr = homePitcher ? `${homePitcher.name} (${homePitcher.wins}-${homePitcher.losses}, ${homePitcher.era} ERA, ${homePitcher.whip} WHIP${ipStr(homePitcher)})` : "TBD";
  const awayPStr = awayPitcher ? `${awayPitcher.name} (${awayPitcher.wins}-${awayPitcher.losses}, ${awayPitcher.era} ERA, ${awayPitcher.whip} WHIP${ipStr(awayPitcher)})` : "N/A";
  const homeFormStr = hf ? `${hf.avg} AVG, ${hf.ops} OPS, ${hf.homeRuns} HR, ${hf.runs} R in ${hf.gamesPlayed} games` : "no data";
  const awayFormStr = af ? `${af.avg} AVG, ${af.ops} OPS, ${af.homeRuns} HR, ${af.runs} R in ${af.gamesPlayed} games` : "no data";

  // Run filter before Claude so the prompt includes honest context
  const preFilter = applyFilterLayer(pick, { ...game, source: game.source }, mlb, modelProb);
  const flagSummary = preFilter.flags.length
    ? preFilter.flags.map(f => f.replace(/_/g, " ").toLowerCase()).join(", ")
    : "none";

  const prompt = `You are a sharp MLB betting analyst. Be direct, specific, honest. No hype.

Game: ${game.awayTeam} @ ${game.homeTeam}
Home odds: ${game.homeOdds > 0 ? "+" : ""}${game.homeOdds} | Away odds: ${game.awayOdds > 0 ? "+" : ""}${game.awayOdds}
Model pick: ${pick} | Raw edge: ${edgePct.toFixed(1)}%
Filter verdict: ${preFilter.verdict} | True edge (sharp-adjusted): ${preFilter.trueEdgePct}% | Variance: ${preFilter.variance}
Risk flags: ${flagSummary}
Park factor: ${preFilter.parkFactor > 0 ? "+" : ""}${preFilter.parkFactor} runs (${game.homeTeam} home park)
Home pitcher: ${homePStr}
Away pitcher: ${awayPStr}
${game.homeTeam} last 10: ${homeFormStr}
${game.awayTeam} last 10: ${awayFormStr}

IMPORTANT: If filter verdict is TRAP or PASS, explain why honestly. If flags mention small_sample or era_whip_mismatch, flag the stat as unreliable.

Return ONLY valid JSON no markdown:
{
  "pick": "${pick}",
  "pitcher_home": "${homePStr}",
  "pitcher_away": "${awayPStr}",
  "preview": "2 sentences. Name the pitchers. Lead with the sharpest reason to bet or fade.",
  "form_home": "1 sentence on ${game.homeTeam} recent form with numbers (or 'no data available')",
  "form_away": "1 sentence on ${game.awayTeam} recent form with numbers (or 'no data available')",
  "what_decides": "1 sentence — the single factor that tips this game",
  "what_to_sweat": "1 sentence — biggest risk if you take ${pick}",
  "honest_lean": "1-2 sentences blunt take. Mention if edge is fake or real. Like texting a sharp friend.",
  "score_range": "e.g. 5-3",
  "tier": { "level": "High | Medium | Low" }
}`;

  try {
    const text = await callClaude(prompt);
    const clean = text.replace(/```json|```/g, "").trim();
    let breakdown = {};
    try { breakdown = JSON.parse(clean); } catch {}
    if (homePitcher) breakdown.pitcher_home = homePStr;
    if (awayPitcher) breakdown.pitcher_away = awayPStr;

    const tier = breakdown.tier?.level
      ? {
          label: breakdown.tier.level === "High" ? "🔥 Value Pick" : breakdown.tier.level === "Medium" ? "✅ Solid Pick" : "👀 Lean",
          level: breakdown.tier.level,
          emoji: breakdown.tier.level === "High" ? "🔥" : breakdown.tier.level === "Medium" ? "✅" : "👀",
        }
      : getConfidenceTier(edgePct / 100) || { label: "👀 Lean", level: "Low", emoji: "👀" };

    const finalPick = breakdown.pick || pick;
    const filter = finalPick === pick ? preFilter : applyFilterLayer(finalPick, { ...game, source: game.source }, mlb, modelProb);

    // isBet requires both raw edge AND filter verdict
    const filteredIsBet = isBet && (filter.verdict === "CLEAN" || filter.verdict === "SOFT");

    return {
      id: game.id, homeTeam: game.homeTeam, awayTeam: game.awayTeam,
      commenceTime: game.commenceTime, homeOdds: game.homeOdds, awayOdds: game.awayOdds,
      pick: finalPick,
      edge: edgePct,
      isBet: filteredIsBet,
      tier, breakdown, filter,
      liveScore: mlb ? { status: mlb.status, homeScore: mlb.homeScore, awayScore: mlb.awayScore, inning: mlb.inning, inningHalf: mlb.inningHalf } : null,
    };
  } catch {
    const tier = getConfidenceTier(edgePct / 100) || { label: "👀 Lean", level: "Low", emoji: "👀" };
    const filter = applyFilterLayer(pick, { ...game, source: game.source }, mlb, modelProb);
    const filteredIsBet = isBet && (filter.verdict === "CLEAN" || filter.verdict === "SOFT");
    return {
      id: game.id, homeTeam: game.homeTeam, awayTeam: game.awayTeam,
      commenceTime: game.commenceTime, homeOdds: game.homeOdds, awayOdds: game.awayOdds,
      pick, edge: edgePct, isBet: filteredIsBet, tier, filter,
      breakdown: { pitcher_home: homePStr, pitcher_away: awayPStr },
      liveScore: null,
    };
  }
}

const ODDS_CACHE_KEY = "__odds__";
const ODDS_TTL_MS = 1000 * 60 * 15; // 15 min

async function fetchOddsWithCache() {
  // 1. Try live API
  try {
    const games = await fetchMLBOdds();
    if (games?.length) {
      // Persist to Supabase so the next cold instance can use it
      supabase
        .from("picks_cache")
        .upsert({ date: ODDS_CACHE_KEY, picks: games, generated_at: new Date().toISOString() }, { onConflict: "date" })
        .then(() => {}).catch(() => {});
      return games;
    }
  } catch (e) {
    console.warn("[odds] live fetch failed:", e.message);
  }

  // 2. Fall back to Supabase-cached odds
  const { data } = await supabase
    .from("picks_cache")
    .select("picks, generated_at")
    .eq("date", ODDS_CACHE_KEY)
    .single();

  if (data?.picks?.length) {
    const age = Date.now() - new Date(data.generated_at).getTime();
    if (age < ODDS_TTL_MS) {
      console.warn("[odds] using Supabase-cached odds, age:", Math.round(age / 1000) + "s");
      return data.picks;
    }
    // Stale but better than nothing
    console.warn("[odds] Supabase odds stale but serving anyway");
    return data.picks;
  }

  return [];
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date") || new Date().toISOString().split("T")[0];

    const { data: cached } = await supabase
      .from("picks_cache")
      .select("picks, generated_at")
      .eq("date", date)
      .single();

    if (cached?.picks?.length) {
      return Response.json({ picks: cached.picks, cached: true, generated_at: cached.generated_at });
    }

    const [oddsGames, mlbRes] = await Promise.all([
      fetchOddsWithCache(),
      fetch(`${BASE_URL}/api/mlb?date=${date}`).then(r => r.json()).catch(() => ({ games: [] })),
    ]);

    const mlbGames = mlbRes?.games || [];

    if (!oddsGames.length) {
      return Response.json({ picks: [], cached: false, notice: "odds unavailable" });
    }

    const settled = await Promise.allSettled(
      oddsGames.map(game => processGame(game, mlbGames))
    );
    const results = [];
    for (const s of settled) {
      if (s.status === "fulfilled" && s.value) results.push(s.value);
    }

    results.sort((a, b) => b.edge - a.edge);

    const { safeCard, balancedCard, aggressiveCard } = buildParlayCards(results);

    if (results.length) {
      await supabase
        .from("picks_cache")
        .upsert({ date, picks: results, generated_at: new Date().toISOString() }, { onConflict: "date" });
    }

    return Response.json({ picks: results, safeCard, balancedCard, aggressiveCard, cached: false });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
