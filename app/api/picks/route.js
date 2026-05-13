// app/api/picks/route.js
import { createClient } from "@supabase/supabase-js";
import { fetchMLBOdds } from "../../../lib/odds.js";
import { calculateEdge, getConfidenceTier } from "../../../lib/edge.js";
import { getModelProbability } from "../../../lib/probability.js";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// In-memory fallback cache (10 min TTL) for same serverless instance
const memCache = new Map();
const TTL = 1000 * 60 * 10;

const getMemCached = async (key, fn) => {
  const hit = memCache.get(key);
  if (hit && Date.now() - hit.time < TTL) return hit.data;
  const data = await fn();
  memCache.set(key, { data, time: Date.now() });
  return data;
};

function getModelProb(mlb) {
  if (!mlb) return 0.52;
  const homeOps = parseFloat(mlb.homeForm?.ops) || 0.720;
  const awayOps = parseFloat(mlb.awayForm?.ops) || 0.720;
  const homeEra = parseFloat(mlb.homePitcher?.era) || 4.50;
  const awayEra = parseFloat(mlb.awayPitcher?.era) || 4.50;
  const raw = (homeOps - awayOps) * 0.4 + (awayEra - homeEra) / 10 * 0.4 + 0.03;
  return Math.min(0.75, Math.max(0.25, 0.5 + raw));
}

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
        model: "claude-sonnet-4-20250514",
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
  const modelProb = await getModelProbability(game);
  const edge = calculateEdge(modelProb, game.homeImplied);
  const pick = edge >= 0 ? game.homeTeam : game.awayTeam;
  const homePitcher = mlb?.homePitcher;
  const awayPitcher = mlb?.awayPitcher;
  const hf = mlb?.homeForm;
  const af = mlb?.awayForm;
  const homePStr = homePitcher ? `${homePitcher.name} (${homePitcher.wins}-${homePitcher.losses}, ${homePitcher.era} ERA, ${homePitcher.whip} WHIP)` : "TBD";
  const awayPStr = awayPitcher ? `${awayPitcher.name} (${awayPitcher.wins}-${awayPitcher.losses}, ${awayPitcher.era} ERA, ${awayPitcher.whip} WHIP)` : "N/A";
  const homeFormStr = hf ? `${hf.avg} AVG, ${hf.ops} OPS, ${hf.homeRuns} HR, ${hf.runs} R in ${hf.gamesPlayed} games` : "N/A";
  const awayFormStr = af ? `${af.avg} AVG, ${af.ops} OPS, ${af.homeRuns} HR, ${af.runs} R in ${af.gamesPlayed} games` : "N/A";

  const prompt = `You are a sharp MLB betting analyst. Be direct, specific, honest. No hype.

Game: ${game.awayTeam} @ ${game.homeTeam}
Home odds: ${game.homeOdds > 0 ? "+" : ""}${game.homeOdds} | Away odds: ${game.awayOdds > 0 ? "+" : ""}${game.awayOdds}
Home pitcher: ${homePStr}
Away pitcher: ${awayPStr}
${game.homeTeam} last 10: ${homeFormStr}
${game.awayTeam} last 10: ${awayFormStr}
Lean: ${pick}

Return ONLY valid JSON no markdown:
{
  "pick": "${pick}",
  "pitcher_home": "${homePStr}",
  "pitcher_away": "${awayPStr}",
  "preview": "2 sentences. Mention pitchers by name. Most important thing to know.",
  "form_home": "1 sentence on ${game.homeTeam} form with real numbers",
  "form_away": "1 sentence on ${game.awayTeam} form with real numbers",
  "what_decides": "1 sentence on what decides this game",
  "what_to_sweat": "1 sentence biggest risk taking ${pick}",
  "honest_lean": "1-2 sentences. Blunt. Like texting a friend.",
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
      : getConfidenceTier(edge) || { label: "👀 Lean", level: "Low", emoji: "👀" };

    return {
      id: game.id, homeTeam: game.homeTeam, awayTeam: game.awayTeam,
      commenceTime: game.commenceTime, homeOdds: game.homeOdds, awayOdds: game.awayOdds,
      pick: breakdown.pick || pick, tier, breakdown,
      liveScore: mlb ? { status: mlb.status, homeScore: mlb.homeScore, awayScore: mlb.awayScore, inning: mlb.inning, inningHalf: mlb.inningHalf } : null,
    };
  } catch {
    return {
      id: game.id, homeTeam: game.homeTeam, awayTeam: game.awayTeam,
      commenceTime: game.commenceTime, homeOdds: game.homeOdds, awayOdds: game.awayOdds,
      pick, tier: getConfidenceTier(edge) || { label: "👀 Lean", level: "Low", emoji: "👀" },
      breakdown: { pitcher_home: homePStr, pitcher_away: awayPStr }, liveScore: null,
    };
  }
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date") || new Date().toISOString().split("T")[0];

    // Step 1: Try Supabase cache first
    const { data: cached } = await supabase
      .from("picks_cache")
      .select("picks, generated_at")
      .eq("date", date)
      .single();

    if (cached?.picks?.length) {
      return Response.json({
        picks: cached.picks,
        cached: true,
        generated_at: cached.generated_at,
      });
    }

    // Step 2: Fall back to live compute + cache result
    const [oddsGames, mlbRes] = await Promise.all([
      getMemCached("odds", fetchMLBOdds),
      getMemCached(`mlb_${date}`, async () =>
        fetch(`${BASE_URL}/api/mlb?date=${date}`).then(r => r.json())
      ),
    ]);

    const mlbGames = mlbRes?.games || [];

    // Run all Claude calls in parallel instead of sequentially
    const settled = await Promise.allSettled(
      oddsGames.map(game => processGame(game, mlbGames))
    );
    const results = [];
    for (const s of settled) {
      if (s.status === "fulfilled" && s.value) results.push(s.value);
    }

    // Store in Supabase so next request is instant
    if (results.length) {
      await supabase
        .from("picks_cache")
        .upsert({ date, picks: results, generated_at: new Date().toISOString() }, { onConflict: "date" });
    }

    return Response.json({ picks: results, cached: false });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
