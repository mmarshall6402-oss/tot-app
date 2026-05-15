// app/api/cron/resolve/route.js
// Runs at 6 AM UTC (~1 AM ET). Resolves yesterday's pending model picks
// by fetching final scores from the MLB Stats API.

import { createClient } from "@supabase/supabase-js";

const MLB_API = "https://statsapi.mlb.com/api/v1";

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function GET(request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
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

    const schedRes = await fetch(`${MLB_API}/schedule?sportId=1&hydrate=linescore&date=${date}`);
    const schedData = await schedRes.json();
    const games = schedData?.dates?.[0]?.games || [];

    let resolved = 0;
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

      let result = "push";
      if (homeScore > awayScore) result = pick.home_team === pick.pick ? "win" : "loss";
      else if (awayScore > homeScore) result = pick.away_team === pick.pick ? "win" : "loss";

      await supabase
        .from("model_picks")
        .update({ result, home_score: homeScore, away_score: awayScore, resolved_at: new Date().toISOString() })
        .eq("id", pick.id);

      resolved++;
    }

    return Response.json({ resolved, total: pending.length, date });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
