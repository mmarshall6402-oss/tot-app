import { createClient } from "@supabase/supabase-js";
import { fetchMLBOdds } from "../../../lib/odds.js";
import { calculateEdge, BET_THRESHOLD, getConfidenceTier } from "../../../lib/edge.js";
import { getModelProbability } from "../../../lib/probability.js";
import { applyFilterLayer, buildParlayCards } from "../../../lib/filter.js";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
// Server-side route — use service role key to bypass RLS on picks_cache reads
const getSupabase = () => createClient(
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
  const prompt = `You are a sharp MLB betting analyst. Be direct, honest, no hype. You understand that MLB has enormous variance and even strong edges lose frequently.

RULES — never violate these:
- Do NOT lead with pitcher ERA comparison as the main reason to bet. Pitching is one factor among many.
- Do NOT treat a SP ERA/WHIP mismatch as the decisive edge unless sample size is large (50+ IP).
- Flag any pitcher with under 40 IP as "small sample — stats not stable."
- Bullpens finish ~40% of outs. Always note bullpen state if data is provided.
- Offensive strength (OPS, run production) matters equally to pitching. Note it.
- Edge % is a model estimate, NOT a calibrated probability. Never present it as precise.
- MLB variance is extreme. Every pick can lose regardless of edge. Say so when honest_lean is written.
- Do NOT treat "Value Pick" tier as guaranteed — it means the model sees edge, not a lock.

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
  "preview": "2 sentences. Name pitchers but don't make SP the only story. Lead with the strongest signal — offense, bullpen, or edge. Flag small samples.",
  "form_home": "1 sentence on home team offense with OPS/runs numbers, or 'no data'",
  "form_away": "1 sentence on away team offense with OPS/runs numbers, or 'no data'",
  "what_decides": "1 sentence — single factor (could be bullpen, lineup depth, park, SP — pick the real one)",
  "what_to_sweat": "1 sentence — biggest risk to this pick losing, including MLB variance",
  "honest_lean": "1-2 sentences blunt take. Say if edge is thin noise or real signal. Remind that all MLB picks carry variance.",
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
  const modelProbRaw = getModelProbability(game, mlb);

  // Market calibration: the market already prices in most public information.
  // Our model provides ~20% incremental signal on top of market pricing.
  // This shrinks raw edges to realistic MLB magnitudes (1–8%) and prevents
  // data corruption from inflating phantom edges to 20–40%.
  const homeImplied  = game.homeImplied || 0.5;
  const modelProb    = homeImplied + (modelProbRaw - homeImplied) * 0.20;

  const rawEdge  = calculateEdge(modelProb, homeImplied);
  const pick     = rawEdge >= 0 ? game.homeTeam : game.awayTeam;
  // Hard cap: >8% displayed edge almost never exists in liquid MLB markets
  const edgePct  = Math.min(Math.abs(rawEdge) * 100, 8.0);
  const isBet    = edgePct >= BET_THRESHOLD * 100;

  const homePitcher = mlb?.homePitcher;
  const awayPitcher = mlb?.awayPitcher;
  // Filter uses RAW model probability — it has its own shrinkFactor calibration
  const filter    = applyFilterLayer(pick, { ...game, source: game.source }, mlb, modelProbRaw);
  const filteredIsBet = ["CLEAN", "BET"].includes(filter.verdict);

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
  const lastWord = s => (s || "").trim().split(" ").pop().toLowerCase();
  const cityWord = s => (s || "").trim().split(" ")[0].toLowerCase(); // "Detroit", "New", "Los"

  // Primary: match on last word of team name (e.g. "tigers", "guardians")
  let match = mlbGames.find(g =>
    g.homeTeam?.toLowerCase().includes(lastWord(game.homeTeam)) &&
    g.awayTeam?.toLowerCase().includes(lastWord(game.awayTeam))
  );

  // Fallback: match on second-to-last word (catches "Red Sox" vs "White Sox" ambiguity)
  if (!match) {
    match = mlbGames.find(g => {
      const hw = game.homeTeam?.trim().split(" ").slice(-2).join(" ").toLowerCase();
      const aw = game.awayTeam?.trim().split(" ").slice(-2).join(" ").toLowerCase();
      return g.homeTeam?.toLowerCase().includes(hw) && g.awayTeam?.toLowerCase().includes(aw);
    });
  }

  return match || null;
}

const ODDS_CACHE_KEY = "__odds__";
const ODDS_TTL_MS = 1000 * 60 * 15; // 15 min

async function fetchOddsWithCache() {
  const supabase = getSupabase();
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
  const supabase = getSupabase();
  try {
    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date") || new Date().toISOString().split("T")[0];
    const bust = searchParams.get("bust") === "1";

    const { data: cached } = await supabase
      .from("picks_cache")
      .select("picks, generated_at")
      .eq("date", date)
      .single();

    if (!bust && cached?.picks?.length) {
      // Fetch fresh MLB data — update live scores AND pitcher strings (starters may post after cache)
      const mlbRes = await fetch(`${BASE_URL}/api/mlb?date=${date}`).then(r => r.json()).catch(() => ({ games: [] }));
      const mlbGames = mlbRes?.games || [];
      const ipStr = (p) => p?.inningsPitched ? ` ${p.inningsPitched} IP` : "";
      const picks = mlbGames.length
        ? cached.picks.map(pick => {
            const mlb = matchMLBGame(pick, mlbGames);
            if (!mlb) return pick;
            const homePStr = mlb.homePitcher ? `${mlb.homePitcher.name} (${mlb.homePitcher.wins}-${mlb.homePitcher.losses}, ${mlb.homePitcher.era} ERA, ${mlb.homePitcher.whip} WHIP${ipStr(mlb.homePitcher)})` : null;
            const awayPStr = mlb.awayPitcher ? `${mlb.awayPitcher.name} (${mlb.awayPitcher.wins}-${mlb.awayPitcher.losses}, ${mlb.awayPitcher.era} ERA, ${mlb.awayPitcher.whip} WHIP${ipStr(mlb.awayPitcher)})` : null;
            return {
              ...pick,
              liveScore: { status: mlb.status, homeScore: mlb.homeScore, awayScore: mlb.awayScore, inning: mlb.inning, inningHalf: mlb.inningHalf },
              breakdown: {
                ...pick.breakdown,
                pitcher_home: homePStr || pick.breakdown?.pitcher_home,
                pitcher_away: awayPStr || pick.breakdown?.pitcher_away,
              },
            };
          })
        : cached.picks;
      return Response.json({ picks, cached: true, generated_at: cached.generated_at });
    }

    const today = new Date().toISOString().split("T")[0];

    // Past date with no cache — build results from MLB API directly (odds aren't available for past dates)
    if (date < today) {
      const mlbRes = await fetch(`${BASE_URL}/api/mlb?date=${date}`).then(r => r.json()).catch(() => ({ games: [] }));
      const mlbGames = mlbRes?.games || [];
      if (mlbGames.length) {
        const ipStr = (p) => p?.inningsPitched ? ` ${p.inningsPitched} IP` : "";
        const results = mlbGames.map(g => {
          const modelProb = getModelProbability({ homeTeam: g.homeTeam, awayTeam: g.awayTeam, homeImplied: 0.5, commenceTime: g.commenceTime }, g);
          const pick = modelProb >= 0.5 ? g.homeTeam : g.awayTeam;
          return {
            id: String(g.gameId),
            homeTeam: g.homeTeam, awayTeam: g.awayTeam,
            commenceTime: g.commenceTime,
            homeOdds: null, awayOdds: null,
            pick, edge: Math.abs(modelProb - 0.5) * 100,
            isBet: false,
            tier: { label: "📋 Result", level: "Low", emoji: "📋" },
            breakdown: {
              pitcher_home: g.homePitcher ? `${g.homePitcher.name} (${g.homePitcher.wins}-${g.homePitcher.losses}, ${g.homePitcher.era} ERA${ipStr(g.homePitcher)})` : "TBD",
              pitcher_away: g.awayPitcher ? `${g.awayPitcher.name} (${g.awayPitcher.wins}-${g.awayPitcher.losses}, ${g.awayPitcher.era} ERA${ipStr(g.awayPitcher)})` : "N/A",
            },
            filter: null,
            liveScore: { status: g.status, homeScore: g.homeScore, awayScore: g.awayScore, inning: g.inning, inningHalf: g.inningHalf },
          };
        });
        return Response.json({ picks: results, cached: false, pastDate: true });
      }
      return Response.json({ picks: [], cached: false, notice: "no data for this date" });
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
