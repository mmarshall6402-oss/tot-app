// app/api/steals/route.js
// Returns only CLEAN picks (passed the AND-gate) sorted by true edge.
// Reads from picks_cache first; falls back to live computation.

import { createClient } from "@supabase/supabase-js";
import { fetchMLBOdds } from "../../../lib/odds.js";
import { getModelProbability } from "../../../lib/probability.js";
import { calculateEdge } from "../../../lib/edge.js";
import { applyFilterLayer } from "../../../lib/filter.js";
import { requirePro } from "../../../lib/auth.js";

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
  return mlbGames.find(g =>
    norm(g.homeTeam).includes(lastWord(game.homeTeam)) &&
    norm(g.awayTeam).includes(lastWord(game.awayTeam)) &&
    timeClose(g.commenceTime, game.commenceTime)
  ) || null;
}

export async function GET(request) {
  const { error: authError } = await requirePro(request);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date") || new Date().toISOString().split("T")[0];

  try {
    // Read from picks_cache first — cron already did the heavy lifting
    const { data: cached } = await getSupabase()
      .from("picks_cache")
      .select("picks")
      .eq("date", date)
      .single();

    if (cached?.picks) {
      const steals = cached.picks
        .filter(p => p.filter?.verdict === "CLEAN")
        .sort((a, b) => (b.filter?.trueEdgePct || 0) - (a.filter?.trueEdgePct || 0));
      return Response.json({ steals, source: "cache" });
    }

    // Live fallback: compute filter for all games (cron hasn't run yet)
    const [games, mlbRes] = await Promise.all([
      fetchMLBOdds(),
      fetch(`${BASE_URL}/api/mlb?date=${date}`).then(r => r.json()).catch(() => ({})),
    ]);
    const mlbGames = mlbRes?.games || [];

    const steals = games
      .map(game => {
        const mlb = matchMLBGame(game, mlbGames);
        const modelProbRaw = getModelProbability(game, mlb);
        const homeImplied  = game.homeImplied || 0.5;
        const modelProb    = homeImplied + (modelProbRaw - homeImplied) * 0.20;
        const rawEdge  = calculateEdge(modelProb, homeImplied);
        const pick     = rawEdge >= 0 ? game.homeTeam : game.awayTeam;
        const filter = applyFilterLayer(pick, { ...game, source: game.source }, mlb, modelProbRaw);
        if (filter.verdict !== "CLEAN") return null;
        const edgePct  = Math.min(Math.max(filter.trueEdgePct, 0), 12.0);
        const hp = mlb?.homePitcher;
        const ap = mlb?.awayPitcher;
        const ipStr = p => p?.inningsPitched ? ` ${p.inningsPitched} IP` : "";
        return {
          ...game, pick, edge: edgePct, isBet: true, filter,
          breakdown: {
            pitcher_home: hp ? `${hp.name} (${hp.era} ERA${ipStr(hp)})` : "TBD",
            pitcher_away: ap ? `${ap.name} (${ap.era} ERA${ipStr(ap)})` : "TBD",
          },
        };
      })
      .filter(Boolean)
      .sort((a, b) => (b.filter?.trueEdgePct || 0) - (a.filter?.trueEdgePct || 0));

    return Response.json({ steals, source: "live" });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
