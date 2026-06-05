// app/api/cron/resolve/route.js
// Runs at 8 AM UTC (3 AM CT). Resolves ALL pending model picks from the last 14 days.
// Multi-date sweep handles delayed resolutions, missed cron runs, and postponed games.

import { createClient } from "@supabase/supabase-js";
import { getEloRatings, updateEloAfterGame } from "../../../../lib/elo-db.js";
import { timingSafeEqual } from "../../../../lib/auth.js";

const MLB_API = "https://statsapi.mlb.com/api/v1";

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function ctDateStr(d = new Date()) {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(d);
  return `${p.find(x=>x.type==="year").value}-${p.find(x=>x.type==="month").value}-${p.find(x=>x.type==="day").value}`;
}

export async function GET(request) {
  const authHeader = request.headers.get("authorization")?.replace("Bearer ", "");
  if (!timingSafeEqual(authHeader, process.env.CRON_SECRET)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabase();
  const todayStr = ctDateStr();

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 14);
  const cutoffStr = ctDateStr(cutoff);

  try {
    // Sweep all pending picks from the last 14 days, excluding today (games may still be live)
    const { data: pending } = await supabase
      .from("model_picks")
      .select("*")
      .eq("result", "pending")
      .gte("date", cutoffStr)
      .lt("date", todayStr)
      .order("date", { ascending: true });

    if (!pending?.length) {
      return Response.json({ resolved: 0, message: "No pending picks to resolve", cutoff: cutoffStr });
    }

    // Group by date to minimise MLB API calls (one per date, not one per pick)
    const byDate = {};
    for (const pick of pending) {
      if (!byDate[pick.date]) byDate[pick.date] = [];
      byDate[pick.date].push(pick);
    }

    const eloRatings = await getEloRatings(supabase);
    let currentElo = { ...eloRatings };
    let resolved = 0;
    const eloUpdatedGames = new Set();
    const resolvedDates = new Set();

    const lw = s => (s || "").toLowerCase().split(" ").pop();

    for (const [date, datePicks] of Object.entries(byDate)) {
      const schedData = await fetch(
        `${MLB_API}/schedule?sportId=1&hydrate=linescore&date=${date}`
      ).then(r => r.json()).catch(() => ({}));

      const games = schedData?.dates?.[0]?.games || [];

      const findGame = (pick) => games.find(g => {
        const ht = g.teams?.home?.team?.name?.toLowerCase() || "";
        const at = g.teams?.away?.team?.name?.toLowerCase() || "";
        return ht.includes(lw(pick.home_team)) && at.includes(lw(pick.away_team));
      });

      for (const pick of datePicks) {
        const mlbGame = findGame(pick);
        if (!mlbGame) continue;

        const detailed = mlbGame.status?.detailedState || "";
        let result, homeScore = null, awayScore = null;

        if (["Postponed", "Suspended", "Cancelled", "Canceled"].some(s => detailed.includes(s))) {
          result = "push";
        } else {
          if (mlbGame.status?.abstractGameState !== "Final") continue;
          homeScore = mlbGame.linescore?.teams?.home?.runs ?? mlbGame.teams?.home?.score ?? null;
          awayScore = mlbGame.linescore?.teams?.away?.runs ?? mlbGame.teams?.away?.score ?? null;
          if (homeScore === null || awayScore === null) continue;
          result = "push";
          if (homeScore > awayScore) result = pick.home_team === pick.pick ? "win" : "loss";
          else if (awayScore > homeScore) result = pick.away_team === pick.pick ? "win" : "loss";
        }

        await supabase
          .from("model_picks")
          .update({
            result,
            home_score: homeScore,
            away_score: awayScore,
            resolved_at: new Date().toISOString(),
          })
          .eq("id", pick.id);

        // Update ELO only once per game per date (doubleheaders get one ELO update per game)
        const gameKey = `${date}|${pick.home_team}|${pick.away_team}`;
        if (!eloUpdatedGames.has(gameKey) && result !== "push" && homeScore !== null) {
          currentElo = await updateEloAfterGame(
            supabase, pick.home_team, pick.away_team, homeScore > awayScore, currentElo
          );
          eloUpdatedGames.add(gameKey);
        }

        resolvedDates.add(date);
        resolved++;
      }
    }

    // Re-count is_bet wins/losses per date after all updates for accurate daily_stats
    for (const date of resolvedDates) {
      const { data: dayData } = await supabase
        .from("model_picks")
        .select("result, is_bet")
        .eq("date", date)
        .eq("is_bet", true)
        .in("result", ["win", "loss"]);

      const dayWins = dayData?.filter(p => p.result === "win").length || 0;
      const dayLosses = dayData?.filter(p => p.result === "loss").length || 0;
      if (dayWins + dayLosses > 0) {
        await supabase.from("model_daily_stats").upsert(
          { date, wins: dayWins, losses: dayLosses },
          { onConflict: "date" }
        );
      }
    }

    return Response.json({
      resolved,
      total: pending.length,
      dates: Object.keys(byDate),
      eloUpdated: eloUpdatedGames.size,
    });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
