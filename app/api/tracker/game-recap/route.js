import { requireAuth } from "../../../../lib/auth.js";

const MLB_API = "https://statsapi.mlb.com/api/v1";

async function getBoxscore(gamePk) {
  const [boxRes, lineRes] = await Promise.all([
    fetch(`${MLB_API}/game/${gamePk}/boxscore`),
    fetch(`${MLB_API}/game/${gamePk}/linescore`),
  ]);
  const [box, line] = await Promise.all([boxRes.json(), lineRes.json()]);
  return { box, line };
}

function parseBoxscore(box, line) {
  const home = box.teams?.home;
  const away = box.teams?.away;

  const homeName = home?.team?.name || "";
  const awayName = away?.team?.name || "";
  const homeRuns = line?.teams?.home?.runs ?? home?.teamStats?.batting?.runs ?? null;
  const awayRuns = line?.teams?.away?.runs ?? away?.teamStats?.batting?.runs ?? null;
  const homeHits = home?.teamStats?.batting?.hits ?? null;
  const awayHits = away?.teamStats?.batting?.hits ?? null;

  function getStarter(teamBox) {
    const pitchers = teamBox?.pitchers || [];
    if (!pitchers.length) return null;
    const id = pitchers[0];
    const p = teamBox?.players?.[`ID${id}`];
    if (!p) return null;
    const stats = p.stats?.pitching;
    return {
      name: p.person?.fullName || "Unknown",
      ip: stats?.inningsPitched ?? "?",
      er: stats?.earnedRuns ?? "?",
      k: stats?.strikeOuts ?? "?",
      bb: stats?.baseOnBalls ?? "?",
    };
  }

  function getNotables(teamBox) {
    const batters = teamBox?.batters || [];
    return batters
      .map(id => teamBox?.players?.[`ID${id}`])
      .filter(p => p && ((p.stats?.batting?.hits ?? 0) >= 2 || (p.stats?.batting?.rbi ?? 0) >= 1))
      .map(p => ({
        name: p.person?.fullName || "",
        h: p.stats?.batting?.hits ?? 0,
        rbi: p.stats?.batting?.rbi ?? 0,
        hr: p.stats?.batting?.homeRuns ?? 0,
      }))
      .slice(0, 2);
  }

  return {
    homeName, awayName, homeRuns, awayRuns, homeHits, awayHits,
    homeStarter: getStarter(home),
    awayStarter: getStarter(away),
    homeNotables: getNotables(home),
    awayNotables: getNotables(away),
  };
}

// Find MLB gamePk from schedule by matching team names + date
async function findGamePk(homeTeam, awayTeam, date) {
  const res = await fetch(`${MLB_API}/schedule?sportId=1&hydrate=linescore&date=${date}`);
  const data = await res.json();
  const games = data?.dates?.[0]?.games || [];
  const norm = s => (s || "").toLowerCase();
  const lastWord = s => norm(s).split(" ").pop();
  const game = games.find(g => {
    const ht = norm(g.teams?.home?.team?.name || "");
    const at = norm(g.teams?.away?.team?.name || "");
    return ht.includes(lastWord(homeTeam)) && at.includes(lastWord(awayTeam));
  });
  return game?.gamePk ?? null;
}

export async function GET(request) {
  const { error: authError } = await requireAuth(request);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const gamePk = searchParams.get("gamePk");
  const homeTeam = searchParams.get("homeTeam");
  const awayTeam = searchParams.get("awayTeam");
  const date = searchParams.get("date");

  try {
    let pk = null;

    // If gamePk looks like a real MLB integer ID, try it directly first
    if (gamePk && /^\d+$/.test(gamePk)) {
      pk = gamePk;
    }

    // Fall back to schedule lookup by team names + date
    if (!pk && homeTeam && awayTeam && date) {
      pk = await findGamePk(homeTeam, awayTeam, date);
    }

    // If we still have a string gamePk (odds API ID), try schedule lookup
    if (!pk && homeTeam && awayTeam && date) {
      pk = await findGamePk(homeTeam, awayTeam, date);
    }

    if (!pk) return Response.json({ error: "Game not found" }, { status: 404 });

    const { box, line } = await getBoxscore(pk);
    if (!box?.teams) return Response.json({ error: "No boxscore data" }, { status: 404 });

    return Response.json(parseBoxscore(box, line));
  } catch (e) {
    return Response.json({ error: "Failed to fetch game data" }, { status: 500 });
  }
}
