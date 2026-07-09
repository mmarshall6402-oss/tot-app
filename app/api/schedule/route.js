import { requireAuth } from "../../../lib/auth.js";
import { fetchNFLOdds } from "../../../lib/nfl-odds.js";

const MLB_API = "https://statsapi.mlb.com/api/v1";

function ctDateStr(d) {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(d);
  return `${p.find(x => x.type === "year").value}-${p.find(x => x.type === "month").value}-${p.find(x => x.type === "day").value}`;
}

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

// The Odds API only returns games it has posted lines for — typically the
// next ~1-2 weeks — so the NFL calendar naturally trails off further out
// until books post lines, rather than erroring.
async function fetchNFLSchedule(start, end) {
  const odds = await fetchNFLOdds();
  const startMs = new Date(`${start}T00:00:00Z`).getTime();
  const endMs = new Date(`${end}T23:59:59Z`).getTime();

  return odds
    .filter(g => {
      const t = new Date(g.commenceTime).getTime();
      return t >= startMs && t <= endMs;
    })
    .map(g => ({
      id: g.id,
      date: ctDateStr(new Date(g.commenceTime)),
      commenceTime: g.commenceTime,
      homeTeam: g.homeTeam,
      awayTeam: g.awayTeam,
      homeOdds: g.homeOdds,
      awayOdds: g.awayOdds,
      spread: g.spread,
      total: g.total,
      status: "Scheduled",
      venue: null,
    }))
    .sort((a, b) => new Date(a.commenceTime) - new Date(b.commenceTime));
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
