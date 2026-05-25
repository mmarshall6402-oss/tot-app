// app/api/cron/resolve/route.js
// Runs at 8 AM UTC (3 AM CT). Resolves yesterday's pending model picks,
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

  const ctFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
  });
  const ctParts = (d) => { const p = ctFormatter.formatToParts(d); return `${p.find(x=>x.type==="year").value}-${p.find(x=>x.type==="month").value}-${p.find(x=>x.type==="day").value}`; };
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const date = ctParts(yesterday);
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

      if (!mlbGame) continue;

      const detailed = mlbGame.status?.detailedState || "";
      let result;
      let homeScore = null, awayScore = null;

      // Postponed / suspended / cancelled → push (stake returned, game didn't happen)
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
        const homeWon = homeScore > awayScore;
        currentElo = await updateEloAfterGame(
          supabase, pick.home_team, pick.away_team, homeWon, currentElo
        );
        eloUpdatedTeams.add(gameKey);
      }

      resolved++;
    }

    // Update model_daily_stats — only count actual bets, not PASS/TRAP picks
    const lw = s => (s || "").toLowerCase().split(" ").pop();
    const findGame = p => games.find(g => {
      const ht = g.teams?.home?.team?.name?.toLowerCase() || "";
      const at = g.teams?.away?.team?.name?.toLowerCase() || "";
      return ht.includes(lw(p.home_team)) && at.includes(lw(p.away_team));
    });

    let dayWins = 0, dayLosses = 0;
    for (const p of pending) {
      if (!p.is_bet) continue;
      const g = findGame(p);
      if (!g || g.status?.abstractGameState !== "Final") continue;
      const hs = g.linescore?.teams?.home?.runs ?? g.teams?.home?.score ?? null;
      const as = g.linescore?.teams?.away?.runs ?? g.teams?.away?.score ?? null;
      if (hs === null || as === null || hs === as) continue;
      if (p.home_team === p.pick ? hs > as : as > hs) dayWins++;
      else dayLosses++;
    }

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
