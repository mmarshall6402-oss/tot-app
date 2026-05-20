// app/api/cron/picks/route.js
// Runs at 11 AM UTC daily. Generates full picks with Claude breakdowns
// and writes to Supabase cache. On-demand /api/picks serves from this cache.
import { createClient } from "@supabase/supabase-js";
import { fetchMLBOdds } from "../../../../lib/odds.js";
import { calculateEdge, BET_THRESHOLD, getConfidenceTier } from "../../../../lib/edge.js";
import { getModelProbability, setEloRatings } from "../../../../lib/probability.js";
import { applyFilterLayer, buildParlayCards } from "../../../../lib/filter.js";
import { getEloRatings } from "../../../../lib/elo-db.js";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function matchMLBGame(game, mlbGames) {
  const norm = s => (s || "").toLowerCase().trim();
  const lastWord = s => norm(s).split(" ").pop();
  const timeClose = (t1, t2) => {
    if (!t1 || !t2) return true;
    return Math.abs(new Date(t1) - new Date(t2)) < 12 * 3_600_000;
  };

  // 1. Exact normalized full name (most reliable)
  let match = mlbGames.find(g =>
    norm(g.homeTeam) === norm(game.homeTeam) &&
    norm(g.awayTeam) === norm(game.awayTeam) &&
    timeClose(g.commenceTime, game.commenceTime)
  );
  if (match) return match;

  // 2. Last-word substring with time guard
  match = mlbGames.find(g =>
    norm(g.homeTeam).includes(lastWord(game.homeTeam)) &&
    norm(g.awayTeam).includes(lastWord(game.awayTeam)) &&
    timeClose(g.commenceTime, game.commenceTime)
  );
  if (match) return match;

  // 3. Two-word suffix (Red Sox / White Sox / Blue Jays) with time guard
  match = mlbGames.find(g => {
    const hw = norm(game.homeTeam).split(" ").slice(-2).join(" ");
    const aw = norm(game.awayTeam).split(" ").slice(-2).join(" ");
    return norm(g.homeTeam).includes(hw) && norm(g.awayTeam).includes(aw) &&
      timeClose(g.commenceTime, game.commenceTime);
  });

  return match || null;
}

async function callClaudeBatch(gameContexts) {
  const prompt = `You are a sharp MLB betting analyst. Direct, honest, no hype. You understand that MLB has enormous variance and even strong edges lose frequently.

RULES — never violate these:
- Do NOT lead with pitcher ERA comparison as the main reason to bet. Pitching is one factor among many.
- Do NOT treat a SP ERA/WHIP mismatch as the decisive edge unless sample size is large (50+ IP).
- Flag any pitcher with under 40 IP as "small sample — stats not stable."
- Bullpens finish ~40% of outs. Always note bullpen state if data is provided.
- Offensive strength (OPS, run production) matters equally to pitching. Note it.
- Edge % is a model estimate, NOT a calibrated probability. Never present it as precise.
- MLB variance is extreme. Every pick can lose regardless of edge. Say so when honest_lean is written.

Analyze these games. Return a JSON array — one object per game, same order.

${gameContexts.map((g, i) => `
GAME ${i + 1}: ${g.awayTeam} @ ${g.homeTeam}
  Odds: home ${g.homeOdds > 0 ? "+" : ""}${g.homeOdds} / away ${g.awayOdds > 0 ? "+" : ""}${g.awayOdds}
  Pick: ${g.pick} | True edge: ${g.trueEdgePct}% | Verdict: ${g.verdict} | Variance: ${g.variance}
  Flags: ${g.flags || "none"} | Park: ${g.parkFactor > 0 ? "+" : ""}${g.parkFactor} runs
  ${g.homeTeam} SP: ${g.homePStr}
  ${g.awayTeam} SP: ${g.awayPStr}
  ${g.homeTeam} bullpen: ${g.homeBullpenStr}
  ${g.awayTeam} bullpen: ${g.awayBullpenStr}
  ${g.homeTeam} record: ${g.homeRecordStr} | lineup vs pitcher: ${g.homeLineupStr}
  ${g.awayTeam} record: ${g.awayRecordStr} | lineup vs pitcher: ${g.awayLineupStr}
  ${g.homeTeam} last 10: ${g.homeFormStr}
  ${g.awayTeam} last 10: ${g.awayFormStr}`).join("\n")}

Return ONLY a JSON array, no markdown. Each element:
{
  "preview": "2 sentences. Name pitchers but don't make SP the only story. Lead with the strongest signal — offense, bullpen, or edge. Flag small samples.",
  "form_home": "1 sentence home team offense with OPS/runs numbers, or 'no data'",
  "form_away": "1 sentence away team offense with OPS/runs numbers, or 'no data'",
  "what_decides": "1 sentence — single factor (bullpen, lineup depth, park, or SP — pick the real one)",
  "what_to_sweat": "1 sentence — biggest risk to this pick losing, including MLB variance",
  "honest_lean": "1-2 sentences blunt take. Say if edge is thin noise or real signal. Remind that all MLB picks carry variance.",
  "score_range": "e.g. 5-3",
  "tier": { "level": "High" }
}`;

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
  if (!res.ok || data.error) throw new Error(`Claude API error: ${JSON.stringify(data.error || data)}`);
  const text = data.content?.[0]?.text || "[]";
  try {
    return JSON.parse(text.replace(/```json|```/g, "").trim());
  } catch (e) {
    throw new Error(`Claude returned invalid JSON: ${text.slice(0, 200)}`);
  }
}

function buildPick(game, mlb, breakdown, precomputedFilter) {
  const modelProbRaw = getModelProbability(game, mlb);

  // Market calibration: model provides ~20% incremental signal over efficient market pricing.
  // Shrinks raw edges to realistic MLB magnitudes and dampens data-corruption artifacts.
  const homeImplied = game.homeImplied || 0.5;
  const modelProb   = homeImplied + (modelProbRaw - homeImplied) * 0.20;

  const rawEdge  = calculateEdge(modelProb, homeImplied);
  const pick     = rawEdge >= 0 ? game.homeTeam : game.awayTeam;
  const edgePct  = Math.min(Math.abs(rawEdge) * 100, 8.0); // hard cap at 8%
  const isBet    = edgePct >= BET_THRESHOLD * 100;
  // Filter uses RAW model probability — it has its own shrinkFactor calibration
  const filter    = precomputedFilter || applyFilterLayer(pick, { ...game, source: game.source }, mlb, modelProbRaw);
  const filteredIsBet = ["CLEAN", "BET"].includes(filter.verdict);

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
    commenceTime: mlb?.commenceTime || game.commenceTime,
    homeOdds: game.homeOdds, awayOdds: game.awayOdds,
    pick, edge: edgePct, isBet: filteredIsBet, tier,
    breakdown: { ...(breakdown || {}), pitcher_home: homePStr, pitcher_away: awayPStr },
    filter,
    liveScore: mlb ? { status: mlb.status, homeScore: mlb.homeScore, awayScore: mlb.awayScore, inning: mlb.inning, inningHalf: mlb.inningHalf } : null,
  };
}

async function generateForDate(date, oddsGames, supabase) {
  const { data: existing } = await supabase
    .from("picks_cache").select("picks").eq("date", date).single();
  if (existing?.picks?.some(p => p.breakdown?.preview)) {
    return { skipped: true, date };
  }

  const mlbRes = await fetch(`${BASE_URL}/api/mlb?date=${date}`).then(r => r.json()).catch(() => ({}));
  const mlbGames = mlbRes?.games || [];

  // Filter odds games to those scheduled on this date (check UTC date and ET date to
  // handle west coast night games that cross midnight UTC into the next calendar day).
  const dateOdds = oddsGames.filter(game => {
    if (!game.commenceTime) return false;
    const t = new Date(game.commenceTime);
    const utcDate = t.toISOString().split("T")[0];
    const etDate  = new Date(t.getTime() - 5 * 3600000).toISOString().split("T")[0];
    return utcDate === date || etDate === date;
  });
  if (!dateOdds.length) return { skipped: true, date, reason: "no odds games for date" };

  const ipStr = (p) => p?.inningsPitched ? ` ${p.inningsPitched} IP` : "";
  const bullStr = b => b
    ? `${b.era} ERA, ${b.whip ?? "?"} WHIP, K/9 ${b.k9 ?? "?"}${b.isRolling ? ` (${b.window}d rolling)` : " (season)"}`
    : "no data";

  const gameContexts = dateOdds.map(game => {
    const mlb          = matchMLBGame(game, mlbGames);
    const modelProbRaw = getModelProbability(game, mlb);
    const homeImplied  = game.homeImplied || 0.5;
    const modelProb    = homeImplied + (modelProbRaw - homeImplied) * 0.20;
    const rawEdge      = calculateEdge(modelProb, homeImplied);
    const pick         = rawEdge >= 0 ? game.homeTeam : game.awayTeam;
    const filter       = applyFilterLayer(pick, { ...game, source: game.source }, mlb, modelProbRaw);
    const hp = mlb?.homePitcher, ap = mlb?.awayPitcher;
    const hf = mlb?.homeForm, af = mlb?.awayForm;
    const hb = mlb?.homeBullpen, ab = mlb?.awayBullpen;
    const hs = mlb?.homeStandings, as_ = mlb?.awayStandings;
    const hlo = mlb?.homeLineupOpsVsPitcher, alo = mlb?.awayLineupOpsVsPitcher;
    return {
      game, mlb, pick,
      homePStr: hp ? `${hp.name} (${hp.wins}-${hp.losses}, ${hp.era} ERA, ${hp.whip} WHIP${ipStr(hp)})` : "TBD",
      awayPStr: ap ? `${ap.name} (${ap.wins}-${ap.losses}, ${ap.era} ERA, ${ap.whip} WHIP${ipStr(ap)})` : "N/A",
      homeFormStr: hf ? `${hf.avg} AVG, ${hf.ops} OPS, ${hf.homeRuns} HR, ${hf.runs} R` : "no data",
      awayFormStr: af ? `${af.avg} AVG, ${af.ops} OPS, ${af.homeRuns} HR, ${af.runs} R` : "no data",
      homeBullpenStr: bullStr(hb), awayBullpenStr: bullStr(ab),
      homeRecordStr: hs ? `${hs.wins}-${hs.losses}` : "no data",
      awayRecordStr: as_ ? `${as_.wins}-${as_.losses}` : "no data",
      homeLineupStr: hlo != null ? `${parseFloat(hlo).toFixed(3)} OPS vs pitcher hand` : "not posted",
      awayLineupStr: alo != null ? `${parseFloat(alo).toFixed(3)} OPS vs pitcher hand` : "not posted",
      homeTeam: game.homeTeam, awayTeam: game.awayTeam,
      homeOdds: game.homeOdds, awayOdds: game.awayOdds,
      filter,
      trueEdgePct: filter.trueEdgePct, verdict: filter.verdict,
      variance: filter.variance, parkFactor: filter.parkFactor,
      flags: filter.flags.map(f => f.replace(/_/g, " ").toLowerCase()).join(", ") || "none",
    };
  });

  const breakdowns = await callClaudeBatch(gameContexts);
  const results = gameContexts.map((ctx, i) =>
    buildPick(ctx.game, ctx.mlb, breakdowns[i] || {}, ctx.filter)
  ).filter(Boolean);

  results.sort((a, b) => b.edge - a.edge);

  await supabase.from("picks_cache")
    .upsert({ date, picks: results, generated_at: new Date().toISOString() }, { onConflict: "date" });

  if (date === new Date().toISOString().split("T")[0]) {
    const pickRows = gameContexts.map((ctx, i) => {
      const result = results[i];
      if (!result) return null;
      return {
        date, home_team: ctx.game.homeTeam, away_team: ctx.game.awayTeam,
        pick: result.pick,
        predicted_prob: Math.round(getModelProbability(ctx.game, ctx.mlb) * 1000) / 1000,
        edge_pct: result.edge, verdict: result.filter?.verdict || "PASS", result: "pending",
      };
    }).filter(Boolean);
    if (pickRows.length) {
      await supabase.from("model_picks").upsert(pickRows, {
        onConflict: "date,home_team,away_team", ignoreDuplicates: true,
      });
    }
  }

  return { date, count: results.length };
}

export async function GET(request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const today    = new Date().toISOString().split("T")[0];
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split("T")[0];

    const supabase = getSupabase();
    const [oddsGames, liveElo] = await Promise.all([
      fetchMLBOdds(),
      getEloRatings(supabase),
    ]);
    setEloRatings(liveElo);

    // Generate today then tomorrow sequentially — each Claude call needs its own context
    const todayResult    = await generateForDate(today, oddsGames, supabase);
    const tomorrowResult = await generateForDate(tomorrow, oddsGames, supabase);

    return Response.json({ today: todayResult, tomorrow: tomorrowResult });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
