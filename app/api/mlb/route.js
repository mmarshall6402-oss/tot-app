const MLB = "https://statsapi.mlb.com/api/v1";
const CURRENT_SEASON = 2026;
const FALLBACK_SEASON = 2026;

function getPastDate(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split("T")[0];
}

async function fetchPitcherStats(pitcherId) {
  if (!pitcherId) return null;
  for (const season of [CURRENT_SEASON, FALLBACK_SEASON]) {
    try {
      const r = await fetch(`${MLB}/people/${pitcherId}/stats?stats=season&group=pitching&season=${season}`);
      const d = await r.json();
      const stat = d?.stats?.[0]?.splits?.[0]?.stat;
      if (stat && (stat.era || stat.whip || stat.wins !== undefined)) return { ...stat, _season: season };
    } catch {}
  }
  return null;
}

async function fetchTeamHitting(teamId, startDate, endDate) {
  if (!teamId) return null;
  for (const season of [CURRENT_SEASON, FALLBACK_SEASON]) {
    try {
      const r = await fetch(`${MLB}/teams/${teamId}/stats?stats=byDateRange&group=hitting&season=${season}&startDate=${startDate}&endDate=${endDate}`);
      const d = await r.json();
      const stat = d?.stats?.[0]?.splits?.[0]?.stat;
      if (stat && stat.gamesPlayed > 0) return stat;
    } catch {}
  }
  return null;
}

async function fetchTeamPitching(teamId) {
  if (!teamId) return null;
  for (const season of [CURRENT_SEASON, FALLBACK_SEASON]) {
    try {
      const r = await fetch(`${MLB}/teams/${teamId}/stats?stats=season&group=pitching&season=${season}`);
      const d = await r.json();
      const stat = d?.stats?.[0]?.splits?.[0]?.stat;
      if (stat && stat.era) return stat;
    } catch {}
  }
  return null;
}

async function fetchStandings() {
  try {
    const r = await fetch(`${MLB}/standings?leagueId=103,104&season=${CURRENT_SEASON}&standingsTypes=regularSeason`);
    const d = await r.json();
    const teams = {};
    for (const record of d?.records || []) {
      for (const tr of record.teamRecords || []) {
        teams[tr.team.id] = {
          wins: tr.wins,
          losses: tr.losses,
          runDifferential: tr.runDifferential || 0,
          winningPercentage: parseFloat(tr.winningPercentage) || 0.500,
          streak: tr.streak?.streakCode || "",
        };
      }
    }
    return teams;
  } catch {
    return {};
  }
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const date   = searchParams.get("date") || new Date().toISOString().split("T")[0];
    const past10 = getPastDate(10);

    const [schedRes, standings] = await Promise.all([
      fetch(`${MLB}/schedule?sportId=1&hydrate=probablePitcher,linescore,teams&date=${date}`),
      fetchStandings(),
    ]);

    const schedData = await schedRes.json();
    const games     = schedData?.dates?.[0]?.games || [];

    const enriched = await Promise.all(games.map(async (game) => {
      const homeId      = game.teams?.home?.team?.id;
      const awayId      = game.teams?.away?.team?.id;
      const homePitcher = game.teams?.home?.probablePitcher;
      const awayPitcher = game.teams?.away?.probablePitcher;
      const linescore   = game.linescore;

      const [homePStats, awayPStats, homeForm, awayForm, homeBullpen, awayBullpen] = await Promise.all([
        fetchPitcherStats(homePitcher?.id),
        fetchPitcherStats(awayPitcher?.id),
        fetchTeamHitting(homeId, past10, date),
        fetchTeamHitting(awayId, past10, date),
        fetchTeamPitching(homeId),
        fetchTeamPitching(awayId),
      ]);

      const buildPitcher = (pitcher, stats) => {
        if (!pitcher) return null;
        return {
          name: pitcher.fullName,
          id: pitcher.id,
          era: stats?.era ?? null,
          whip: stats?.whip ?? null,
          wins: stats?.wins ?? 0,
          losses: stats?.losses ?? 0,
          strikeoutsPer9: stats?.strikeoutsPer9Inn ?? null,
          inningsPitched: stats?.inningsPitched ?? null,
        };
      };

      return {
        gameId:       game.gamePk,
        homeTeam:     game.teams?.home?.team?.name,
        awayTeam:     game.teams?.away?.team?.name,
        homeId,
        awayId,
        commenceTime: game.gameDate,
        status:       game.status?.abstractGameState,
        homeScore:    linescore?.teams?.home?.runs ?? null,
        awayScore:    linescore?.teams?.away?.runs ?? null,
        inning:       linescore?.currentInning ?? null,
        inningHalf:   linescore?.inningHalf ?? null,
        homePitcher:  buildPitcher(homePitcher, homePStats),
        awayPitcher:  buildPitcher(awayPitcher, awayPStats),
        homeForm,
        awayForm,
        homeBullpen: homeBullpen ? { era: homeBullpen.era ?? null, whip: homeBullpen.whip ?? null } : null,
        awayBullpen: awayBullpen ? { era: awayBullpen.era ?? null, whip: awayBullpen.whip ?? null } : null,
        homeStandings: standings[homeId] ?? null,
        awayStandings: standings[awayId] ?? null,
      };
    }));

    return Response.json({ games: enriched, date });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
