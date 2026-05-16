// app/api/cron/picks/route.js
// Runs at 11 AM UTC daily. Generates full picks with Claude breakdowns
// and writes to Supabase cache. On-demand /api/picks serves from this cache.
import { createClient } from "@supabase/supabase-js";
import { fetchMLBOdds } from "../../../../lib/odds.js";
import { calculateEdge, BET_THRESHOLD, getConfidenceTier } from "../../../../lib/edge.js";
import { getModelProbability } from "../../../../lib/probability.js";
import { applyFilterLayer, buildParlayCards } from "../../../../lib/filter.js";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function matchMLBGame(game, mlbGames) {
  return mlbGames.find(g => {
    const hw = game.homeTeam?.split(" ").pop()?.toLowerCase();
    const aw = game.awayTeam?.split(" ").pop()?.toLowerCase();
    return g.homeTeam?.toLowerCase().includes(hw) && g.awayTeam?.toLowerCase().includes(aw);
  });
}

async function callClaudeBatch(gameContexts) {
  const prompt = `You are a sharp MLB betting analyst. Direct, honest, no hype.
Analyze these games. Return a JSON array — one object per game, same order.

${gameContexts.map((g, i) => `
GAME ${i + 1}: ${g.awayTeam} @ ${g.homeTeam}
  Odds: home ${g.homeOdds > 0 ? "+" : ""}${g.homeOdds} / away ${g.awayOdds > 0 ? "+" : ""}${g.awayOdds}
  Pick: ${g.pick} | True edge: ${g.trueEdgePct}% | Verdict: ${g.verdict} | Variance: ${g.variance}
  Flags: ${g.flags || "none"} | Park: ${g.parkFactor > 0 ? "+" : ""}${g.parkFactor} runs
  Home SP: ${g.homePStr} | Away SP: ${g.awayPStr}
  ${g.homeTeam} last 10: ${g.homeFormStr}
  ${g.awayTeam} last 10: ${g.awayFormStr}`).join("\n")}

Return ONLY a JSON array, no markdown. Each element:
{
  "preview": "2 sentences. Name pitchers. Sharpest reason to bet or fade. Flag unreliable stats.",
  "form_home": "1 sentence home team recent form with numbers, or 'no data'",
  "form_away": "1 sentence away team recent form with numbers, or 'no data'",
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
    return JSON.parse(text.replace(/```json|```/g, "").trim());
  } catch { return []; }
}

function buildPick(game, mlb, breakdown, precomputedFilter) {
  const modelProb = getModelProbability(game, mlb);
  const rawEdge   = calculateEdge(modelProb, game.homeImplied);
  const pick      = rawEdge >= 0 ? game.homeTeam : game.awayTeam;
  const edgePct   = Math.abs(rawEdge) * 100;
  const isBet     = edgePct >= BET_THRESHOLD * 100;
  const filter    = precomputedFilter || applyFilterLayer(pick, { ...game, source: game.source }, mlb, modelProb);
  const filteredIsBet = isBet;

  const tier = breakdown?.tier?.level
    ? {
        label: breakdown.tier.level === "High" ? "🔥 Value Pick" : breakdown.tier.level === "Medium" ? "✅ Solid Pick" : "👀 Lean",
        level: breakdown.tier.level,
        emoji: breakdown.tier.level === "High" ? "🔥" : breakdown.tier.level === "Medium" ? "✅" : "👀",
      }
    : getConfidenceTier(edgePct / 100) || { label: "👀 Lean", level: "Low", emoji: "👀" };

  const ipStr = (p) => p?.inningsPitched ? ` ${p.inningsPitched} IP` : "";
  const hp = mlb?.homePitcher;
  const ap = mlb?.awayPitcher;
  const homePStr = hp ? `${hp.name} (${hp.wins}-${hp.losses}, ${hp.era} ERA, ${hp.whip} WHIP${ipStr(hp)})` : "TBD";
  const awayPStr = ap ? `${ap.name} (${ap.wins}-${ap.losses}, ${ap.era} ERA, ${ap.whip} WHIP${ipStr(ap)})` : "N/A";

  return {
    id: game.id, homeTeam: game.homeTeam, awayTeam: game.awayTeam,
    commenceTime: game.commenceTime, homeOdds: game.homeOdds, awayOdds: game.awayOdds,
    pick, edge: edgePct, isBet: filteredIsBet, tier,
    breakdown: { ...(breakdown || {}), pitcher_home: homePStr, pitcher_away: awayPStr },
    filter,
    liveScore: mlb ? { status: mlb.status, homeScore: mlb.homeScore, awayScore: mlb.awayScore, inning: mlb.inning, inningHalf: mlb.inningHalf } : null,
  };
}

export async function GET(request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const date = new Date().toISOString().split("T")[0];

    const supabase = getSupabase();
    const { data: existing } = await supabase
      .from("picks_cache")
      .select("id")
      .eq("date", date)
      .single();
    if (existing) return Response.json({ message: "Already cached", date });

    const [oddsGames, mlbRes] = await Promise.all([
      fetchMLBOdds(),
      fetch(`${BASE_URL}/api/mlb?date=${date}`).then(r => r.json()),
    ]);
    const mlbGames = mlbRes?.games || [];

    // Build game contexts for batch Claude call
    const gameContexts = oddsGames.map(game => {
      const mlb = matchMLBGame(game, mlbGames);
      const modelProb = getModelProbability(game, mlb);
      const rawEdge   = calculateEdge(modelProb, game.homeImplied);
      const pick      = rawEdge >= 0 ? game.homeTeam : game.awayTeam;
      const filter    = applyFilterLayer(pick, { ...game, source: game.source }, mlb, modelProb);
      const hf = mlb?.homeForm;
      const af = mlb?.awayForm;
      const ipStr = (p) => p?.inningsPitched ? ` ${p.inningsPitched} IP` : "";
      const hp = mlb?.homePitcher;
      const ap = mlb?.awayPitcher;
      return {
        game, mlb, pick,
        homePStr: hp ? `${hp.name} (${hp.wins}-${hp.losses}, ${hp.era} ERA, ${hp.whip} WHIP${ipStr(hp)})` : "TBD",
        awayPStr: ap ? `${ap.name} (${ap.wins}-${ap.losses}, ${ap.era} ERA, ${ap.whip} WHIP${ipStr(ap)})` : "N/A",
        homeFormStr: hf ? `${hf.avg} AVG, ${hf.ops} OPS, ${hf.homeRuns} HR, ${hf.runs} R` : "no data",
        awayFormStr: af ? `${af.avg} AVG, ${af.ops} OPS, ${af.homeRuns} HR, ${af.runs} R` : "no data",
        homeTeam: game.homeTeam, awayTeam: game.awayTeam,
        homeOdds: game.homeOdds, awayOdds: game.awayOdds,
        filter,  // pass through to avoid recomputing in buildPick
        trueEdgePct: filter.trueEdgePct, verdict: filter.verdict,
        variance: filter.variance, parkFactor: filter.parkFactor,
        flags: filter.flags.map(f => f.replace(/_/g, " ").toLowerCase()).join(", ") || "none",
      };
    });

    const breakdowns = await callClaudeBatch(gameContexts);

    // Pass precomputed filter to buildPick — avoids computing applyFilterLayer twice per game
    const results = gameContexts.map((ctx, i) =>
      buildPick(ctx.game, ctx.mlb, breakdowns[i] || {}, ctx.filter)
    ).filter(Boolean);

    results.sort((a, b) => b.edge - a.edge);
    const { safeCard, balancedCard, aggressiveCard } = buildParlayCards(results);

    await supabase
      .from("picks_cache")
      .upsert({ date, picks: results, generated_at: new Date().toISOString() }, { onConflict: "date" });

    return Response.json({ message: "Picks generated", date, count: results.length, safeCard, balancedCard, aggressiveCard });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
