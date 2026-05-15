import { createClient } from "@supabase/supabase-js";
import { fetchMLBOdds } from "../../../lib/odds.js";
import { calculateEdge, BET_THRESHOLD, getConfidenceTier } from "../../../lib/edge.js";
import { getModelProbability } from "../../../lib/probability.js";
import { applyFilterLayer, buildParlayCards } from "../../../lib/filter.js";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
// Server-side route — use service role key to bypass RLS on picks_cache reads
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
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


// Single Claude call for all games — avoids rate limits and function timeout
async function callClaudeBatch(gameContexts) {
  const prompt = `You are a sharp MLB betting analyst. Be direct, honest, no hype.
Analyze these games and return a JSON array — one object per game, in the same order.

${gameContexts.map((g, i) => `
GAME ${i + 1}: ${g.awayTeam} @ ${g.homeTeam}
  Odds: home ${g.homeOdds > 0 ? "+" : ""}${g.homeOdds} / away ${g.awayOdds > 0 ? "+" : ""}${g.awayOdds}
  Pick: ${g.pick} | True edge: ${g.trueEdgePct}% | Verdict: ${g.verdict} | Variance: ${g.variance}
  Flags: ${g.flags || "none"}
  Park: ${g.parkFactor > 0 ? "+" : ""}${g.parkFactor} runs
  Home SP: ${g.homePStr}
  Away SP: ${g.awayPStr}
  ${g.homeTeam} last 10: ${g.homeFormStr}
  ${g.awayTeam} last 10: ${g.awayFormStr}`).join("\n")}

Return ONLY a valid JSON array, no markdown. Each element:
{
  "preview": "2 sentences. Name pitchers. Lead with sharpest reason to bet or fade. Flag unreliable stats.",
  "form_home": "1 sentence on home team form with numbers, or 'no data'",
  "form_away": "1 sentence on away team form with numbers, or 'no data'",
  "what_decides": "1 sentence — single factor that tips this game",
  "what_to_sweat": "1 sentence — biggest risk",
  "honest_lean": "1-2 sentences blunt take. Say if edge is real or noise.",
  "score_range": "e.g. 5-3",
  "tier": { "level": "High" }
}`;

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
        max_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const data = await res.json();
    const text = data.content?.[0]?.text || "[]";
    const clean = text.replace(/```json|```/g, "").trim();
    return JSON.parse(clean);
  } catch { return []; }
}

function buildPick(game, mlb, breakdown) {
  const modelProb = getModelProbability(game, mlb);
  const rawEdge   = calculateEdge(modelProb, game.homeImplied);
  const pick      = rawEdge >= 0 ? game.homeTeam : game.awayTeam;
  const edgePct   = Math.abs(rawEdge) * 100;
  const isBet     = edgePct >= BET_THRESHOLD * 100;

  const homePitcher = mlb?.homePitcher;
  const awayPitcher = mlb?.awayPitcher;
  const filter    = applyFilterLayer(pick, { ...game, source: game.source }, mlb, modelProb);
  const filteredIsBet = isBet && (filter.verdict === "CLEAN" || filter.verdict === "SOFT");

  const tier = breakdown?.tier?.level
    ? {
        label: breakdown.tier.level === "High" ? "🔥 Value Pick" : breakdown.tier.level === "Medium" ? "✅ Solid Pick" : "👀 Lean",
        level: breakdown.tier.level,
        emoji: breakdown.tier.level === "High" ? "🔥" : breakdown.tier.level === "Medium" ? "✅" : "👀",
      }
    : getConfidenceTier(edgePct / 100) || { label: "👀 Lean", level: "Low", emoji: "👀" };

  const ipStr = (p) => p?.inningsPitched ? ` ${p.inningsPitched} IP` : "";
  const homePStr = homePitcher ? `${homePitcher.name} (${homePitcher.wins}-${homePitcher.losses}, ${homePitcher.era} ERA, ${homePitcher.whip} WHIP${ipStr(homePitcher)})` : "TBD";
  const awayPStr = awayPitcher ? `${awayPitcher.name} (${awayPitcher.wins}-${awayPitcher.losses}, ${awayPitcher.era} ERA, ${awayPitcher.whip} WHIP${ipStr(awayPitcher)})` : "N/A";

  return {
    id: game.id, homeTeam: game.homeTeam, awayTeam: game.awayTeam,
    commenceTime: game.commenceTime, homeOdds: game.homeOdds, awayOdds: game.awayOdds,
    pick, edge: edgePct, isBet: filteredIsBet, tier,
    breakdown: { ...(breakdown || {}), pitcher_home: homePStr, pitcher_away: awayPStr },
    filter,
    liveScore: mlb ? { status: mlb.status, homeScore: mlb.homeScore, awayScore: mlb.awayScore, inning: mlb.inning, inningHalf: mlb.inningHalf } : null,
  };
}

function matchMLBGame(game, mlbGames) {
  return mlbGames.find(g => {
    const hw = game.homeTeam?.split(" ").pop()?.toLowerCase();
    const aw = game.awayTeam?.split(" ").pop()?.toLowerCase();
    return g.homeTeam?.toLowerCase().includes(hw) && g.awayTeam?.toLowerCase().includes(aw);
  });
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

    // Fast path: build picks without Claude (must complete in <10s on Vercel free tier).
    // Claude breakdowns are added by the daily cron job (/api/cron/picks) which
    // pre-warms the Supabase cache. On cache hit above, full breakdowns are served.
    const results = oddsGames.map(game => {
      const mlb = matchMLBGame(game, mlbGames);
      return buildPick(game, mlb, null);
    }).filter(Boolean);

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
