// app/api/steals/route.js
// Returns only CLEAN picks (passed the AND-gate) sorted by true edge.
// Reads from picks_cache first; falls back to live computation.

import { createClient } from "@supabase/supabase-js";
import { fetchMLBOdds } from "../../../lib/odds.js";
import { getModelProbability } from "../../../lib/probability.js";
import { calculateEdge } from "../../../lib/edge.js";
import { applyFilterLayer } from "../../../lib/filter.js";

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

export async function GET(request) {
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
        const modelProb = getModelProbability(game, mlb);
        const rawEdge = calculateEdge(modelProb, game.homeImplied);
        const pick = rawEdge >= 0 ? game.homeTeam : game.awayTeam;
        const edgePct = Math.abs(rawEdge) * 100;
        const filter = applyFilterLayer(pick, { ...game, source: game.source }, mlb, modelProb);
        if (filter.verdict !== "CLEAN") return null;
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
