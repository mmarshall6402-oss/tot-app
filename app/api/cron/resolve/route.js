// app/api/cron/resolve/route.js
// Runs at 6 AM UTC (~1 AM ET). Resolves yesterday's pending model picks,
// updates team ELO ratings, and records calibration data for model feedback.

import { createClient } from "@supabase/supabase-js";
import { getEloRatings, updateEloAfterGame } from "../../../../lib/elo-db.js";
import { timingSafeEqual } from "../../../../lib/auth.js";

const MLB_API = "https://statsapi.mlb.com/api/v1";

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function GET(request) {
  const authHeader = request.headers.get("authorization")?.replace("Bearer ", "");
  if (!timingSafeEqual(authHeader, process.env.CRON_SECRET)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const date = yesterday.toISOString().split("T")[0];
  const supabase = getSupabase();

  try {
    const { data: pending } = await supabase
      .from("model_picks")
      .select("*")
      .eq("date", date)
      .eq("result", "pending");

    if (!pending?.length) {
      return Response.json({ resolved: 0, message: "No pending picks", date });
    }

    const [schedData, eloRatings] = await Promise.all([
      fetch(`${MLB_API}/schedule?sportId=1&hydrate=linescore&date=${date}`)
        .then(r => r.json()).catch(() => ({})),
      getEloRatings(supabase),
    ]);

    const games = schedData?.dates?.[0]?.games || [];
    let currentElo = { ...eloRatings };
    let resolved = 0;
    const eloUpdatedTeams = new Set();

    for (const pick of pending) {
      const mlbGame = games.find(g => {
        const ht = g.teams?.home?.team?.name?.toLowerCase() || "";
        const at = g.teams?.away?.team?.name?.toLowerCase() || "";
        const lastWord = s => s.split(" ").pop();
        return (
          ht.includes(lastWord(pick.home_team?.toLowerCase() || "")) &&
          at.includes(lastWord(pick.away_team?.toLowerCase() || ""))
        );
      });

      if (!mlbGame || mlbGame.status?.abstractGameState !== "Final") continue;

      const homeScore = mlbGame.linescore?.teams?.home?.runs ?? null;
      const awayScore = mlbGame.linescore?.teams?.away?.runs ?? null;
      if (homeScore === null || awayScore === null) continue;

      const homeWon = homeScore > awayScore;
      let result = "push";
      if (homeScore > awayScore) result = pick.home_team === pick.pick ? "win" : "loss";
      else if (awayScore > homeScore) result = pick.away_team === pick.pick ? "win" : "loss";

      // Resolve the pick and record actual scores
      await supabase
        .from("model_picks")
        .update({
          result,
          home_score: homeScore,
          away_score: awayScore,
          resolved_at: new Date().toISOString(),
        })
        .eq("id", pick.id);

      // Update ELO only once per unique game (avoid double-counting doubleheaders)
      const gameKey = `${pick.home_team}|${pick.away_team}`;
      if (!eloUpdatedTeams.has(gameKey) && result !== "push") {
        currentElo = await updateEloAfterGame(
          supabase, pick.home_team, pick.away_team, homeWon, currentElo
        );
        eloUpdatedTeams.add(gameKey);
      }

      resolved++;
    }

    // Update model_daily_stats for today's resolved picks
    const wins   = pending.filter((_, i) => {
      const pick = pending[i];
      // recount from updated data — just use resolved count for now
      return false; // will be recomputed below
    }).length;

    const resolvedPicks = pending.filter(p => {
      const game = games.find(g => {
        const ht = g.teams?.home?.team?.name?.toLowerCase() || "";
        const at = g.teams?.away?.team?.name?.toLowerCase() || "";
        const lw = s => s.split(" ").pop();
        return ht.includes(lw(p.home_team?.toLowerCase() || "")) &&
               at.includes(lw(p.away_team?.toLowerCase() || ""));
      });
      return game?.status?.abstractGameState === "Final";
    });

    const dayWins   = resolvedPicks.filter(p => {
      const g = games.find(g2 => {
        const ht = g2.teams?.home?.team?.name?.toLowerCase() || "";
        const at = g2.teams?.away?.team?.name?.toLowerCase() || "";
        const lw = s => s.split(" ").pop();
        return ht.includes(lw(p.home_team?.toLowerCase() || "")) &&
               at.includes(lw(p.away_team?.toLowerCase() || ""));
      });
      if (!g) return false;
      const hs = g.linescore?.teams?.home?.runs;
      const as = g.linescore?.teams?.away?.runs;
      if (hs == null || as == null) return false;
      return p.home_team === p.pick ? hs > as : as > hs;
    }).length;

    const dayLosses = resolvedPicks.filter(p => {
      const g = games.find(g2 => {
        const ht = g2.teams?.home?.team?.name?.toLowerCase() || "";
        const at = g2.teams?.away?.team?.name?.toLowerCase() || "";
        const lw = s => s.split(" ").pop();
        return ht.includes(lw(p.home_team?.toLowerCase() || "")) &&
               at.includes(lw(p.away_team?.toLowerCase() || ""));
      });
      if (!g) return false;
      const hs = g.linescore?.teams?.home?.runs;
      const as = g.linescore?.teams?.away?.runs;
      if (hs == null || as == null) return false;
      return p.home_team === p.pick ? as > hs : hs > as;
    }).length;

    if (dayWins + dayLosses > 0) {
      await supabase.from("model_daily_stats").upsert({
        date,
        wins: dayWins,
        losses: dayLosses,
      }, { onConflict: "date" });
    }

    return Response.json({
      resolved,
      total: pending.length,
      date,
      eloUpdated: eloUpdatedTeams.size,
      dayRecord: `${dayWins}-${dayLosses}`,
    });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
