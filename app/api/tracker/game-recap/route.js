import { requireAuth } from "../../../../lib/auth.js";

const MLB_API = "https://statsapi.mlb.com/api/v1";

export async function GET(request) {
  const { error: authError } = await requireAuth(request);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const gamePk = searchParams.get("gamePk");
  if (!gamePk) return Response.json({ error: "gamePk required" }, { status: 400 });

  try {
    const [boxRes, lineRes] = await Promise.all([
      fetch(`${MLB_API}/game/${gamePk}/boxscore`),
      fetch(`${MLB_API}/game/${gamePk}/linescore`),
    ]);

    const [box, line] = await Promise.all([boxRes.json(), lineRes.json()]);

    const home = box.teams?.home;
    const away = box.teams?.away;

    const homeName = home?.team?.name || "";
    const awayName = away?.team?.name || "";
    const homeRuns = line?.teams?.home?.runs ?? home?.teamStats?.batting?.runs ?? null;
    const awayRuns = line?.teams?.away?.runs ?? away?.teamStats?.batting?.runs ?? null;
    const homeHits = home?.teamStats?.batting?.hits ?? null;
    const awayHits = away?.teamStats?.batting?.hits ?? null;

    // Starting pitchers: first pitcher listed for each team
    function getStarter(teamBox) {
      const pitchers = teamBox?.pitchers || [];
      if (!pitchers.length) return null;
      const id = pitchers[0];
      const p = teamBox?.players?.[`ID${id}`];
      if (!p) return null;
      const stats = p.stats?.pitching;
      const name = p.person?.fullName || "Unknown";
      const ip = stats?.inningsPitched ?? "?";
      const er = stats?.earnedRuns ?? "?";
      const k = stats?.strikeOuts ?? "?";
      const bb = stats?.baseOnBalls ?? "?";
      return { name, ip, er, k, bb };
    }

    const homeStarter = getStarter(home);
    const awayStarter = getStarter(away);

    // Notable hitters: anyone with 2+ hits or an RBI
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

    const homeNotables = getNotables(home);
    const awayNotables = getNotables(away);

    return Response.json({
      homeName, awayName, homeRuns, awayRuns, homeHits, awayHits,
      homeStarter, awayStarter, homeNotables, awayNotables,
    });
  } catch (e) {
    return Response.json({ error: "Failed to fetch game data" }, { status: 500 });
  }
}
