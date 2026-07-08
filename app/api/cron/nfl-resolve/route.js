// app/api/cron/nfl-resolve/route.js
// Runs daily (see vercel.json). Resolves any pending nfl_model_picks rows whose
// games have gone final, updates nfl_team_elo, and rolls up nfl_daily_stats.
// Mirrors app/api/cron/resolve/route.js's MLB pipeline, but sources final scores
// from ESPN's scoreboard (lib/nfl-stats.js) instead of the MLB Stats API. Unlike
// MLB's "yesterday only" resolve, this grades ALL pending rows regardless of date —
// NFL's weekly Thu/Sun/Mon schedule means a day can still be pending several cron
// cycles after it was generated (e.g. a postponed game), and the pending set is
// small (~16 games x 3 markets/week) so scanning everything is cheap.

import { createClient } from "@supabase/supabase-js";
import { getNFLGamesForDate } from "../../../../lib/nfl-stats.js";
import { getEloRatings, updateEloAfterGame } from "../../../../lib/elo-db.js";
import { timingSafeEqual } from "../../../../lib/auth.js";

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const lastWord = (s) => (s || "").trim().split(" ").pop().toLowerCase();

function findESPNGame(pick, games) {
  return games.find(g => {
    const ht = (g.homeTeam || "").toLowerCase();
    const at = (g.awayTeam || "").toLowerCase();
    return ht.includes(lastWord(pick.home_team)) && at.includes(lastWord(pick.away_team));
  });
}

// Resolves a single pick's win/loss/push given the final score, using the market-
// appropriate line comparison. Spread `line` is the HOME team's market spread
// (negative if home favored), same convention as game.spread throughout the NFL
// pipeline; totals `line` is the market total.
function gradePick(pick, homeScore, awayScore) {
  if (pick.market_type === "spread") {
    const homeMargin = homeScore - awayScore;
    const adjMargin = pick.pick === pick.home_team ? homeMargin + Number(pick.line) : -homeMargin - Number(pick.line);
    if (adjMargin > 0) return "win";
    if (adjMargin < 0) return "loss";
    return "push";
  }
  if (pick.market_type === "total") {
    const totalScore = homeScore + awayScore;
    if (totalScore === Number(pick.line)) return "push";
    const wentOver = totalScore > Number(pick.line);
    return (pick.pick === "Over") === wentOver ? "win" : "loss";
  }
  // moneyline
  if (homeScore === awayScore) return "push";
  if (homeScore > awayScore) return pick.home_team === pick.pick ? "win" : "loss";
  return pick.away_team === pick.pick ? "win" : "loss";
}

export async function GET(request) {
  const authHeader = request.headers.get("authorization")?.replace("Bearer ", "").trim();
  if (!timingSafeEqual(authHeader, process.env.CRON_SECRET)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabase();

  try {
    const { data: pending } = await supabase
      .from("nfl_model_picks")
      .select("*")
      .eq("result", "pending");

    if (!pending?.length) {
      return Response.json({ resolved: 0, message: "No pending picks" });
    }

    const dates = [...new Set(pending.map(p => p.date))];
    const gamesByDate = {};
    await Promise.all(dates.map(async (d) => {
      gamesByDate[d] = await getNFLGamesForDate(d);
    }));

    const eloRatings = await getEloRatings(supabase, "nfl_team_elo", null);
    let currentElo = { ...eloRatings };
    const eloUpdatedGames = new Set();
    const dailyDelta = {}; // date -> { wins, losses } (is_bet only)
    let resolved = 0;

    for (const pick of pending) {
      const games = gamesByDate[pick.date] || [];
      const g = findESPNGame(pick, games);
      if (!g || !g.completed || g.homeScore == null || g.awayScore == null) continue;

      const result = gradePick(pick, g.homeScore, g.awayScore);

      await supabase
        .from("nfl_model_picks")
        .update({ result, home_score: g.homeScore, away_score: g.awayScore, resolved_at: new Date().toISOString() })
        .eq("id", pick.id);
      resolved++;

      // Elo reflects the actual game outcome, not the pick — update once per unique
      // game regardless of how many markets (ml/spread/total) reference it.
      const gameKey = `${pick.home_team}|${pick.away_team}|${pick.date}`;
      if (!eloUpdatedGames.has(gameKey) && g.homeScore !== g.awayScore) {
        currentElo = await updateEloAfterGame(
          supabase, pick.home_team, pick.away_team, g.homeScore > g.awayScore, currentElo, "nfl_team_elo"
        );
        eloUpdatedGames.add(gameKey);
      }

      if (pick.is_bet && (result === "win" || result === "loss")) {
        dailyDelta[pick.date] = dailyDelta[pick.date] || { wins: 0, losses: 0 };
        dailyDelta[pick.date][result === "win" ? "wins" : "losses"]++;
      }
    }

    for (const [date, delta] of Object.entries(dailyDelta)) {
      const { data: existing } = await supabase
        .from("nfl_daily_stats").select("wins, losses").eq("date", date).single();
      await supabase.from("nfl_daily_stats").upsert({
        date,
        wins: (existing?.wins || 0) + delta.wins,
        losses: (existing?.losses || 0) + delta.losses,
      }, { onConflict: "date" });
    }

    return Response.json({ resolved, total: pending.length, eloUpdated: eloUpdatedGames.size });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
