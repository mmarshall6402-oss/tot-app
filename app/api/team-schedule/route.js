import { createClient } from "@supabase/supabase-js";
import { requirePro } from "../../../lib/auth.js";

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Returns all games for a given team across the current week from picks_cache.
// Searches picks_cache for dates from today-3 through today+7.
export async function GET(request) {
  const { error: authError } = await requirePro(request);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const team = (searchParams.get("team") || "").trim();
  if (!team || team.length < 2) {
    return Response.json({ error: "team required" }, { status: 400 });
  }

  const norm = s => (s || "").toLowerCase();
  const teamN = norm(team);

  // Build date range: 3 days back through 7 days forward
  const dates = [];
  for (let offset = -3; offset <= 7; offset++) {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    dates.push(d.toISOString().slice(0, 10));
  }

  try {
  const supabase = getSupabase();
  const { data: rows } = await supabase
    .from("picks_cache")
    .select("date, picks")
    .in("date", dates)
    .order("date", { ascending: true });

  const matches = [];

  for (const row of (rows || [])) {
    for (const pick of (row.picks || [])) {
      const hn = norm(pick.homeTeam || "");
      const an = norm(pick.awayTeam || "");
      // Match on any part of the team name (last word, full name, or nickname)
      const lastWord = s => s.split(" ").pop();
      const isMatch =
        hn.includes(teamN) || an.includes(teamN) ||
        hn.includes(lastWord(teamN)) || an.includes(lastWord(teamN)) ||
        teamN.includes(lastWord(hn)) || teamN.includes(lastWord(an));

      if (isMatch) {
        matches.push({
          date: row.date,
          homeTeam: pick.homeTeam,
          awayTeam: pick.awayTeam,
          homeRecord: pick.homeRecord,
          awayRecord: pick.awayRecord,
          commenceTime: pick.commenceTime,
          homeOdds: pick.homeOdds,
          awayOdds: pick.awayOdds,
          pick: pick.pick,
          edge: pick.edge,
          isBet: pick.isBet,
          filter: pick.filter,
          tier: pick.tier,
          liveScore: pick.liveScore,
          isLock: pick.isLock,
        });
        break; // only one match per pick per date
      }
    }
  }

  // Deduplicate by date (a team only plays once per day)
  const seen = new Set();
  const deduped = matches.filter(m => {
    const key = m.date;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return Response.json({ team, games: deduped });
  } catch (e) {
    console.error("[team-schedule] fatal:", e);
    return Response.json({ error: e?.message || e?.name || "unknown error" }, { status: 500 });
  }
}
