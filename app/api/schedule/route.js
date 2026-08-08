import { requireAuth } from "../../../lib/auth.js";
import { ctDateStr, fetchNFLSchedule } from "../../../lib/nfl-schedule.js";

const MLB_API = "https://statsapi.mlb.com/api/v1";

async function fetchMLBSchedule(start, end) {
  const res = await fetch(`${MLB_API}/schedule?sportId=1&hydrate=linescore,venue&startDate=${start}&endDate=${end}`);
  if (!res.ok) return [];
  const data = await res.json();
  const games = [];
  for (const day of (data?.dates || [])) {
    for (const g of (day.games || [])) {
      const isDecided = g.status?.abstractGameState === "Final" || g.status?.abstractGameState === "Live";
      games.push({
        id: g.gamePk,
        date: day.date,
        commenceTime: g.gameDate,
        homeTeam: g.teams?.home?.team?.name || null,
        awayTeam: g.teams?.away?.team?.name || null,
        homeScore: isDecided ? g.teams?.home?.score ?? null : null,
        awayScore: isDecided ? g.teams?.away?.score ?? null : null,
        status: g.status?.detailedState || null,
        venue: g.venue?.name || null,
      });
    }
  }
  return games;
}

export async function GET(request) {
  const { error: authError } = await requireAuth(request);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const sport = (searchParams.get("sport") || "mlb").toLowerCase();

  const today = new Date();
  const defaultEnd = new Date(today);
  defaultEnd.setDate(defaultEnd.getDate() + 13);

  const start = searchParams.get("start") || ctDateStr(today);
  const end = searchParams.get("end") || ctDateStr(defaultEnd);

  try {
    const games = sport === "nfl" ? await fetchNFLSchedule(start, end) : await fetchMLBSchedule(start, end);
    return Response.json({ sport, start, end, games });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
