// Resolves a user's pending saved picks by checking final scores from MLB API.
// Called when the user opens the tracker tab.

import { createClient } from "@supabase/supabase-js";

const MLB_API = "https://statsapi.mlb.com/api/v1";

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function lastWord(str) {
  return (str || "").trim().split(" ").pop().toLowerCase();
}

async function fetchFinalScores(date) {
  try {
    const res = await fetch(`${MLB_API}/schedule?sportId=1&hydrate=linescore&date=${date}`);
    const data = await res.json();
    return data?.dates?.[0]?.games || [];
  } catch { return []; }
}

function resolveResult(pick, games) {
  const game = games.find(g => {
    const ht = g.teams?.home?.team?.name?.toLowerCase() || "";
    const at = g.teams?.away?.team?.name?.toLowerCase() || "";
    return ht.includes(lastWord(pick.home_team)) && at.includes(lastWord(pick.away_team));
  });

  if (!game || game.status?.abstractGameState !== "Final") return null;

  const homeScore = game.linescore?.teams?.home?.runs ?? null;
  const awayScore = game.linescore?.teams?.away?.runs ?? null;
  if (homeScore === null || awayScore === null) return null;

  if (homeScore === awayScore) return "push";
  if (homeScore > awayScore) return pick.home_team === pick.pick ? "win" : "loss";
  return pick.away_team === pick.pick ? "win" : "loss";
}

export async function POST(request) {
  const { userId } = await request.json();
  if (!userId) return Response.json({ error: "userId required" }, { status: 400 });

  const supabase = getSupabase();

  const { data: pending } = await supabase
    .from("saved_picks")
    .select("*")
    .eq("user_id", userId)
    .eq("result", "pending");

  if (!pending?.length) return Response.json({ resolved: 0 });

  // Only try to resolve games that started more than 3 hours ago
  const cutoff = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const resolvable = pending.filter(p => new Date(p.commence_time) < cutoff);
  if (!resolvable.length) return Response.json({ resolved: 0 });

  // Group by game date
  const byDate = {};
  for (const pick of resolvable) {
    const date = pick.commence_time.split("T")[0];
    if (!byDate[date]) byDate[date] = [];
    byDate[date].push(pick);
  }

  let resolved = 0;
  for (const [date, picks] of Object.entries(byDate)) {
    const games = await fetchFinalScores(date);
    for (const pick of picks) {
      const result = resolveResult(pick, games);
      if (!result) continue;
      await supabase
        .from("saved_picks")
        .update({ result })
        .eq("id", pick.id)
        .eq("user_id", userId);
      resolved++;
    }
  }

  return Response.json({ resolved });
}
