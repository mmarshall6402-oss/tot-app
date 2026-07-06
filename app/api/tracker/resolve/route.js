// Auto-resolves pending saved picks by checking final scores from MLB Stats API.
// Called when the user opens the tracker tab.

import { createClient } from "@supabase/supabase-js";
import { requireAuth } from "../../../../lib/auth.js";

const MLB_API = "https://statsapi.mlb.com/api/v1";

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function lastWord(str) {
  return (str || "").trim().split(" ").pop().toLowerCase();
}

// MLB schedule "date" is the US game-day, not the UTC calendar date — a West
// Coast night game's commence_time can already be past midnight UTC while
// it's still the same evening in US time. Derive the date the same way the
// rest of the pipeline does (America/Chicago) so the schedule lookup below
// queries the day the game actually falls on.
function ctDateStr(iso) {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(iso));
  return `${p.find(x => x.type === "year").value}-${p.find(x => x.type === "month").value}-${p.find(x => x.type === "day").value}`;
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

  if (!game) return null;

  const detailed = game.status?.detailedState || "";
  // Postponed / suspended / cancelled = stake returned → push
  if (["Postponed", "Suspended", "Cancelled", "Canceled"].some(s => detailed.includes(s))) {
    return "push";
  }

  if (game.status?.abstractGameState !== "Final") return null;

  // Try linescore first, fall back to teams.home.score (set on Final games)
  const homeScore = game.linescore?.teams?.home?.runs ?? game.teams?.home?.score ?? null;
  const awayScore = game.linescore?.teams?.away?.runs ?? game.teams?.away?.score ?? null;
  if (homeScore === null || awayScore === null) return null;

  if (homeScore === awayScore) return "push";
  if (homeScore > awayScore) return pick.home_team === pick.pick ? "win" : "loss";
  return pick.away_team === pick.pick ? "win" : "loss";
}

export async function POST(request) {
  const { user, error: authError } = await requireAuth(request);
  if (authError) return authError;

  const { userId } = await request.json();
  if (!userId) return Response.json({ error: "userId required" }, { status: 400 });
  if (user.id !== userId) return Response.json({ error: "Forbidden" }, { status: 403 });

  const supabase = getSupabase();

  const { data: pending } = await supabase
    .from("saved_picks")
    .select("*")
    .eq("user_id", userId)
    .eq("result", "pending");

  if (!pending?.length) return Response.json({ resolved: 0 });

  // Only resolve games that started more than 3 hours ago
  const cutoff = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const resolvable = pending.filter(p => new Date(p.commence_time) < cutoff);
  if (!resolvable.length) return Response.json({ resolved: 0 });

  // Group by game date to minimize MLB API calls
  const byDate = {};
  for (const pick of resolvable) {
    const date = ctDateStr(pick.commence_time);
    if (!byDate[date]) byDate[date] = [];
    byDate[date].push(pick);
  }

  let resolved = 0;
  for (const [date, picks] of Object.entries(byDate)) {
    const games = await fetchFinalScores(date);
    const updates = picks
      .map(pick => ({ pick, result: resolveResult(pick, games) }))
      .filter(({ result }) => result !== null);

    await Promise.all(updates.map(({ pick, result }) =>
      supabase.from("saved_picks").update({ result }).eq("id", pick.id).eq("user_id", userId)
    ));
    resolved += updates.length;
  }

  return Response.json({ resolved });
}
