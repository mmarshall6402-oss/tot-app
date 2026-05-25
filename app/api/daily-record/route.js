import { createClient } from "@supabase/supabase-js";

const MLB_API = "https://statsapi.mlb.com/api/v1";

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const norm = s => (s || "").toLowerCase().replace(/[^a-z]/g, "");

function liveResolve(pick, games) {
  const lw = s => s.split(" ").pop().toLowerCase();
  const game = games.find(g => {
    const ht = g.teams?.home?.team?.name?.toLowerCase() || "";
    const at = g.teams?.away?.team?.name?.toLowerCase() || "";
    return ht.includes(lw(pick.home_team || "")) && at.includes(lw(pick.away_team || ""));
  });
  if (!game) return null;
  const detail = game.status?.detailedState || "";
  if (["Postponed","Suspended","Cancelled","Canceled"].some(s => detail.includes(s))) return "push";
  if (game.status?.abstractGameState !== "Final") return null;
  const hs = game.linescore?.teams?.home?.runs ?? game.teams?.home?.score ?? null;
  const as = game.linescore?.teams?.away?.runs ?? game.teams?.away?.score ?? null;
  if (hs === null || as === null) return null;
  if (hs === as) return "push";
  return hs > as
    ? (pick.home_team === pick.pick ? "win" : "loss")
    : (pick.away_team === pick.pick ? "win" : "loss");
}

export async function GET() {
  const supabase = getSupabase();
  const today = new Date().toISOString().split("T")[0];

  // picks_cache has every game the model analyzed, all verdicts, every date
  // model_picks has settled results from the nightly resolve cron
  const [{ data: cacheRows }, { data: resolvedRows }] = await Promise.all([
    supabase.from("picks_cache").select("date, picks").order("date", { ascending: true }),
    supabase.from("model_picks").select("date, home_team, away_team, pick, result")
      .in("result", ["win","loss","push"]),
  ]);

  // Fast lookup for already-settled results
  const resolvedMap = {};
  for (const p of resolvedRows || []) {
    const key = `${p.date}|${norm(p.home_team)}|${norm(p.away_team)}`;
    resolvedMap[key] = p;
  }

  const byDate = {};
  const pendingByDate = {};

  // Track picks attempted per date (for UI context: "11 of 16 games picked")
  const pickedByDate = {};

  for (const row of cacheRows || []) {
    const { date, picks } = row;
    if (!Array.isArray(picks)) continue;

    for (const p of picks) {
      const homeTeam = p.homeTeam || p.home_team;
      const awayTeam = p.awayTeam || p.away_team;
      const pick = p.pick;
      if (!pick || !homeTeam || !awayTeam) continue;

      pickedByDate[date] = (pickedByDate[date] || 0) + 1;

      const key = `${date}|${norm(homeTeam)}|${norm(awayTeam)}`;
      const resolved = resolvedMap[key];

      if (resolved) {
        if (!byDate[date]) byDate[date] = { wins: 0, losses: 0, pushes: 0 };
        if (resolved.result === "win")  byDate[date].wins++;
        if (resolved.result === "loss") byDate[date].losses++;
        if (resolved.result === "push") byDate[date].pushes++;
      } else if (date <= today) {
        if (!pendingByDate[date]) pendingByDate[date] = [];
        pendingByDate[date].push({ home_team: homeTeam, away_team: awayTeam, pick });
      }
    }
  }

  // Live-resolve anything not yet in model_picks by checking MLB final scores
  const pendingDates = Object.keys(pendingByDate);
  if (pendingDates.length > 0) {
    const schedules = await Promise.all(
      pendingDates.map(date =>
        fetch(`${MLB_API}/schedule?sportId=1&hydrate=linescore&date=${date}`)
          .then(r => r.json())
          .then(d => ({ date, games: d?.dates?.[0]?.games || [] }))
          .catch(() => ({ date, games: [] }))
      )
    );

    for (const { date, games } of schedules) {
      for (const pick of pendingByDate[date]) {
        const result = liveResolve(pick, games);
        if (!result) continue;
        if (!byDate[date]) byDate[date] = { wins: 0, losses: 0, pushes: 0 };
        if (result === "win")  byDate[date].wins++;
        if (result === "loss") byDate[date].losses++;
        if (result === "push") byDate[date].pushes++;
      }
    }
  }

  // Merge pickedByDate into each date's stats
  for (const date of Object.keys(pickedByDate)) {
    if (!byDate[date]) byDate[date] = { wins: 0, losses: 0, pushes: 0 };
    byDate[date].picked = pickedByDate[date];
  }

  return Response.json(byDate);
}
