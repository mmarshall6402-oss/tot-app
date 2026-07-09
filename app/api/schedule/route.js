import { requireAuth } from "../../../lib/auth.js";
import { fetchNFLOdds } from "../../../lib/nfl-odds.js";

const MLB_API = "https://statsapi.mlb.com/api/v1";
const ESPN_NFL_SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";

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

const lastWord = (s) => (s || "").toLowerCase().trim().split(" ").pop();

// ESPN's scoreboard `dates` range param is undocumented and, per lib/nfl-stats.js's
// existing single-date fetcher, unreliable beyond a single week — so this walks the
// window in 7-day chunks rather than trusting one big range request.
async function fetchESPNNFLGames(start, end) {
  const chunkStarts = [];
  const cursor = new Date(`${start}T00:00:00Z`);
  const endD = new Date(`${end}T00:00:00Z`);
  while (cursor <= endD) {
    chunkStarts.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 7);
  }

  const espnFmt = (d) => d.toISOString().slice(0, 10).replace(/-/g, "");

  const chunks = await Promise.all(chunkStarts.map(async (chunkStart) => {
    const chunkEnd = new Date(chunkStart);
    chunkEnd.setDate(chunkEnd.getDate() + 6);
    try {
      const res = await fetch(`${ESPN_NFL_SCOREBOARD}?dates=${espnFmt(chunkStart)}-${espnFmt(chunkEnd)}`);
      if (!res.ok) return [];
      const json = await res.json();
      return json?.events || [];
    } catch {
      return [];
    }
  }));

  const seen = new Set();
  const games = [];
  for (const ev of chunks.flat()) {
    if (seen.has(ev.id)) continue;
    seen.add(ev.id);
    const comp = ev?.competitions?.[0];
    const home = comp?.competitors?.find(c => c?.homeAway === "home");
    const away = comp?.competitors?.find(c => c?.homeAway === "away");
    const homeTeam = home?.team?.displayName || null;
    const awayTeam = away?.team?.displayName || null;
    if (!homeTeam || !awayTeam || !ev.date) continue;
    const completed = !!comp?.status?.type?.completed;
    const inProgress = comp?.status?.type?.state === "in";
    games.push({
      id: `espn_${ev.id}`,
      date: ctDateStr(new Date(ev.date)),
      commenceTime: ev.date,
      homeTeam,
      awayTeam,
      homeOdds: null,
      awayOdds: null,
      spread: null,
      total: null,
      status: completed ? "Final" : inProgress ? "In Progress" : "Scheduled",
      homeScore: completed || inProgress ? Number(home?.score ?? 0) : null,
      awayScore: completed || inProgress ? Number(away?.score ?? 0) : null,
      venue: comp?.venue?.fullName || null,
    });
  }
  return games;
}

// The Odds API only returns games it has posted lines for — typically the next
// ~1-2 weeks — so games further out are backfilled (no odds) from ESPN's
// scoreboard, keyed off matchup + date since the two APIs use different ids.
async function fetchNFLSchedule(start, end) {
  const [odds, espnGames] = await Promise.all([
    fetchNFLOdds(),
    fetchESPNNFLGames(start, end),
  ]);
  const startMs = new Date(`${start}T00:00:00Z`).getTime();
  const endMs = new Date(`${end}T23:59:59Z`).getTime();

  const withOdds = odds
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
      homeScore: null,
      awayScore: null,
      venue: null,
    }));

  const oddsKeys = new Set(withOdds.map(g => `${g.date}|${lastWord(g.homeTeam)}|${lastWord(g.awayTeam)}`));
  const backfill = espnGames.filter(g => !oddsKeys.has(`${g.date}|${lastWord(g.homeTeam)}|${lastWord(g.awayTeam)}`));

  return [...withOdds, ...backfill].sort((a, b) => new Date(a.commenceTime) - new Date(b.commenceTime));
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
