import { requireAuth } from "../../../lib/auth.js";
import { getMLBTeams, getNFLTeams, matchMLBTeam, matchNFLTeam } from "../../../lib/team-list.js";

const MLB_API = "https://statsapi.mlb.com/api/v1";
const ESPN_NFL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";
const ESPN_NFL_STANDINGS = "https://site.api.espn.com/apis/v2/sports/football/nfl/standings";
const CURRENT_SEASON = new Date().getFullYear();

function ctDateStr(d) {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(d);
  return `${p.find(x => x.type === "year").value}-${p.find(x => x.type === "month").value}-${p.find(x => x.type === "day").value}`;
}

// ── MLB ──────────────────────────────────────────────────────────────────

async function buildMLBTeam(name) {
  const teams = await getMLBTeams();
  const team = matchMLBTeam(teams, name);
  if (!team) return null;

  const [rosterRes, standingsRes, scheduleRes] = await Promise.all([
    fetch(`${MLB_API}/teams/${team.id}/roster?rosterType=active`),
    fetch(`${MLB_API}/standings?leagueId=103,104&season=${CURRENT_SEASON}&standingsTypes=regularSeason`),
    fetch(`${MLB_API}/schedule?sportId=1&teamId=${team.id}&startDate=${ctDateStr(new Date(Date.now() - 6 * 86400000))}&endDate=${ctDateStr(new Date(Date.now() + 10 * 86400000))}&hydrate=linescore`),
  ]);

  const rosterJson = rosterRes.ok ? await rosterRes.json() : null;
  const roster = (rosterJson?.roster || []).map(r => ({
    name: r.person?.fullName || null,
    number: r.jerseyNumber || null,
    position: r.position?.abbreviation || null,
  })).filter(r => r.name);

  const standingsJson = standingsRes.ok ? await standingsRes.json() : null;
  let divisionName = team.division?.name || null;
  let standings = [];
  let record = null;
  for (const div of (standingsJson?.records || [])) {
    const rows = div.teamRecords || [];
    const hasTeam = rows.some(tr => tr.team?.id === team.id);
    if (!hasTeam) continue;
    divisionName = div.division?.name || divisionName;
    standings = rows
      .map(tr => ({
        team: tr.team?.name || null,
        wins: tr.wins ?? 0,
        losses: tr.losses ?? 0,
        pct: tr.winningPercentage != null ? parseFloat(tr.winningPercentage) : null,
        gb: tr.gamesBack || null,
        streak: tr.streak?.streakCode || null,
        isCurrentTeam: tr.team?.id === team.id,
      }))
      .sort((a, b) => b.wins - a.wins || a.losses - b.losses);
    const mine = rows.find(tr => tr.team?.id === team.id);
    if (mine) {
      record = {
        wins: mine.wins ?? 0,
        losses: mine.losses ?? 0,
        pct: mine.winningPercentage != null ? parseFloat(mine.winningPercentage) : null,
        streak: mine.streak?.streakCode || null,
      };
    }
    break;
  }

  const scheduleJson = scheduleRes.ok ? await scheduleRes.json() : null;
  const allGames = [];
  for (const day of (scheduleJson?.dates || [])) {
    for (const g of (day.games || [])) {
      const isFinal = g.status?.abstractGameState === "Final";
      allGames.push({
        id: g.gamePk,
        date: day.date,
        commenceTime: g.gameDate,
        homeTeam: g.teams?.home?.team?.name || null,
        awayTeam: g.teams?.away?.team?.name || null,
        homeScore: isFinal ? g.teams?.home?.score ?? null : null,
        awayScore: isFinal ? g.teams?.away?.score ?? null : null,
        status: g.status?.detailedState || null,
        completed: isFinal,
      });
    }
  }
  allGames.sort((a, b) => new Date(a.commenceTime) - new Date(b.commenceTime));
  const now = Date.now();
  const recentGames = allGames.filter(g => g.completed && new Date(g.commenceTime).getTime() <= now).slice(-5);
  const upcomingGames = allGames.filter(g => !g.completed).slice(0, 5);

  return {
    sport: "mlb",
    id: team.id,
    name: team.name,
    division: divisionName,
    record,
    standings,
    roster,
    recentGames,
    upcomingGames,
  };
}

// ── NFL ──────────────────────────────────────────────────────────────────

function extractAthletes(rosterJson) {
  const groups = rosterJson?.athletes || rosterJson?.team?.athletes || [];
  const flat = [];
  for (const group of groups) {
    const items = group?.items || (Array.isArray(group) ? group : []);
    for (const a of items) flat.push(a);
  }
  return flat;
}

async function buildNFLTeam(name) {
  const teams = await getNFLTeams();
  const team = matchNFLTeam(teams, name);
  if (!team) return null;

  const [rosterRes, standingsRes, scheduleRes] = await Promise.all([
    fetch(`${ESPN_NFL}/teams/${team.id}/roster`),
    fetch(ESPN_NFL_STANDINGS),
    fetch(`${ESPN_NFL}/teams/${team.id}/schedule`),
  ]);

  const rosterJson = rosterRes.ok ? await rosterRes.json() : null;
  const roster = extractAthletes(rosterJson).map(a => ({
    name: a?.displayName || null,
    number: a?.jersey || null,
    position: a?.position?.abbreviation || null,
  })).filter(r => r.name);

  const standingsJson = standingsRes.ok ? await standingsRes.json() : null;
  let divisionName = null;
  let standings = [];
  let record = null;
  for (const group of (standingsJson?.children || [])) {
    const entries = group?.standings?.entries || [];
    const mine = entries.find(e => e?.team?.id === team.id);
    if (!mine) continue;
    divisionName = group?.name || group?.abbreviation || null;
    standings = entries.map(e => {
      const stats = {};
      for (const s of (e.stats || [])) {
        if (s?.name) stats[s.name] = typeof s.value === "number" ? s.value : Number(s.value);
      }
      return {
        team: e.team?.displayName || null,
        wins: stats.wins ?? 0,
        losses: stats.losses ?? 0,
        pct: Number.isFinite(stats.winPercent) ? stats.winPercent : null,
        gb: null,
        streak: null,
        isCurrentTeam: e.team?.id === team.id,
      };
    }).sort((a, b) => b.wins - a.wins || a.losses - b.losses);
    const mineStats = {};
    for (const s of (mine.stats || [])) {
      if (s?.name) mineStats[s.name] = typeof s.value === "number" ? s.value : Number(s.value);
    }
    record = {
      wins: mineStats.wins ?? 0,
      losses: mineStats.losses ?? 0,
      pct: Number.isFinite(mineStats.winPercent) ? mineStats.winPercent : null,
      streak: mineStats.streak != null ? String(mineStats.streak) : null,
    };
    break;
  }

  const scheduleJson = scheduleRes.ok ? await scheduleRes.json() : null;
  const allGames = [];
  for (const ev of (scheduleJson?.events || [])) {
    const comp = ev?.competitions?.[0];
    const home = comp?.competitors?.find(c => c?.homeAway === "home");
    const away = comp?.competitors?.find(c => c?.homeAway === "away");
    const homeTeam = home?.team?.displayName || null;
    const awayTeam = away?.team?.displayName || null;
    if (!homeTeam || !awayTeam || !ev.date) continue;
    const completed = !!comp?.status?.type?.completed;
    allGames.push({
      id: ev.id,
      date: ctDateStr(new Date(ev.date)),
      commenceTime: ev.date,
      homeTeam,
      awayTeam,
      homeScore: completed ? Number(home?.score ?? 0) : null,
      awayScore: completed ? Number(away?.score ?? 0) : null,
      status: completed ? "Final" : "Scheduled",
      completed,
    });
  }
  allGames.sort((a, b) => new Date(a.commenceTime) - new Date(b.commenceTime));
  const now = Date.now();
  const recentGames = allGames.filter(g => g.completed && new Date(g.commenceTime).getTime() <= now).slice(-5);
  const upcomingGames = allGames.filter(g => !g.completed).slice(0, 5);

  return {
    sport: "nfl",
    id: team.id,
    name: team.displayName,
    division: divisionName,
    record,
    standings,
    roster,
    recentGames,
    upcomingGames,
  };
}

export async function GET(request) {
  const { error: authError } = await requireAuth(request);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const sport = (searchParams.get("sport") || "mlb").toLowerCase();
  const team = (searchParams.get("team") || "").trim();
  if (!team) return Response.json({ error: "team required" }, { status: 400 });

  try {
    const data = sport === "nfl" ? await buildNFLTeam(team) : await buildMLBTeam(team);
    if (!data) return Response.json({ error: "team not found" }, { status: 404 });
    return Response.json(data);
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
