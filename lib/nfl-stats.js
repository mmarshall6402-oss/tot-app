// ESPN hidden API fetcher for NFL team stats (free, no key).
// Mirrors the fetchFromESPN pattern already proven in lib/odds.js for MLB.
// ESPN's site API is unofficial/undocumented — every parse here is defensive
// and degrades to null/neutral on shape mismatch rather than throwing.

const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";
const ESPN_STANDINGS = "https://site.api.espn.com/apis/v2/sports/football/nfl/standings";
const ESPN_SCOREBOARD = `${ESPN_BASE}/scoreboard`;

const TEAMS_TTL = 1000 * 60 * 60 * 12; // team list/ids rarely change
const STANDINGS_TTL = 1000 * 60 * 30;
const TEAM_DETAIL_TTL = 1000 * 60 * 30;

let _teamsCache = null;
let _teamsCacheTime = 0;

let _standingsCache = null;
let _standingsCacheTime = 0;

const _statsCache = new Map(); // teamId -> { data, time }
const _scheduleCache = new Map(); // teamId -> { data, time }

const YARDS_PER_PLAY_KEYS = ["yardsPerPlay", "netYardsPerGame", "totalYardsPerGame", "yardsPerGame"];
const POINTS_PER_GAME_KEYS = ["totalPointsPerGame", "pointsPerGame", "avgPoints"];

// ── Team index (name -> id/abbreviation) ──────────────────────────────────

async function fetchTeamsIndex() {
  if (_teamsCache && Date.now() - _teamsCacheTime < TEAMS_TTL) return _teamsCache;
  const res = await fetch(`${ESPN_BASE}/teams?limit=40`);
  if (!res.ok) throw new Error(`ESPN teams ${res.status}`);
  const json = await res.json();
  const list = json?.sports?.[0]?.leagues?.[0]?.teams || [];
  const teams = list.map(t => t.team).filter(Boolean).map(t => ({
    id: t.id,
    abbreviation: t.abbreviation,
    displayName: t.displayName,
    shortDisplayName: t.shortDisplayName,
    location: t.location,
    name: t.name,
  }));
  _teamsCache = teams;
  _teamsCacheTime = Date.now();
  return teams;
}

function matchTeam(teams, name) {
  const n = (name || "").toLowerCase().trim();
  if (!n) return null;
  return teams.find(t => (t.displayName || "").toLowerCase() === n)
      || teams.find(t => (t.shortDisplayName || "").toLowerCase() === n)
      || teams.find(t => t.name && n.endsWith((t.name || "").toLowerCase()))
      || null;
}

// ── Standings: record, points for/against ─────────────────────────────────

async function fetchStandings() {
  if (_standingsCache && Date.now() - _standingsCacheTime < STANDINGS_TTL) return _standingsCache;
  const res = await fetch(ESPN_STANDINGS);
  if (!res.ok) throw new Error(`ESPN standings ${res.status}`);
  const json = await res.json();
  const entries = (json?.children || []).flatMap(c => c?.standings?.entries || []);
  const byTeamId = {};
  for (const e of entries) {
    const id = e?.team?.id;
    if (!id) continue;
    const stats = {};
    for (const s of (e.stats || [])) {
      if (s?.name) stats[s.name] = typeof s.value === "number" ? s.value : Number(s.value);
    }
    const wins = stats.wins ?? 0;
    const losses = stats.losses ?? 0;
    const ties = stats.ties ?? 0;
    byTeamId[id] = {
      wins, losses, ties,
      pointsFor: Number.isFinite(stats.pointsFor) ? stats.pointsFor : null,
      pointsAgainst: Number.isFinite(stats.pointsAgainst) ? stats.pointsAgainst : null,
      gamesPlayed: Number.isFinite(stats.gamesPlayed) ? stats.gamesPlayed : (wins + losses + ties),
    };
  }
  _standingsCache = byTeamId;
  _standingsCacheTime = Date.now();
  return byTeamId;
}

// ── Per-team statistics: offensive yards/play efficiency (best effort) ────

function findStat(categories, keys) {
  for (const cat of (categories || [])) {
    for (const stat of (cat?.stats || [])) {
      if (keys.includes(stat?.name)) {
        const v = Number(stat.value);
        if (Number.isFinite(v)) return v;
      }
    }
  }
  return null;
}

async function fetchTeamStatistics(teamId) {
  const cached = _statsCache.get(teamId);
  if (cached && Date.now() - cached.time < TEAM_DETAIL_TTL) return cached.data;
  try {
    const res = await fetch(`${ESPN_BASE}/teams/${teamId}/statistics`);
    if (!res.ok) { _statsCache.set(teamId, { data: null, time: Date.now() }); return null; }
    const json = await res.json();
    const categories = json?.splits?.categories || json?.results?.stats?.categories || [];
    const data = {
      yardsPerPlay: findStat(categories, YARDS_PER_PLAY_KEYS),
      pointsPerGame: findStat(categories, POINTS_PER_GAME_KEYS),
    };
    _statsCache.set(teamId, { data, time: Date.now() });
    return data;
  } catch {
    _statsCache.set(teamId, { data: null, time: Date.now() });
    return null;
  }
}

// ── Per-team schedule: recent form (last 3) + days rest ───────────────────

function scheduleCompetitorScore(c) {
  const raw = c?.score;
  if (raw == null) return null;
  const v = typeof raw === "object" ? raw.value ?? raw.displayValue : raw;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function fetchTeamSchedule(teamId) {
  const cached = _scheduleCache.get(teamId);
  if (cached && Date.now() - cached.time < TEAM_DETAIL_TTL) return cached.data;
  try {
    const res = await fetch(`${ESPN_BASE}/teams/${teamId}/schedule`);
    if (!res.ok) { _scheduleCache.set(teamId, { data: null, time: Date.now() }); return null; }
    const json = await res.json();
    const events = json?.events || [];
    const completed = [];
    for (const ev of events) {
      const comp = ev?.competitions?.[0];
      const completedFlag = comp?.status?.type?.completed;
      if (!completedFlag) continue;
      const self = comp?.competitors?.find(c => String(c?.team?.id) === String(teamId));
      const opp = comp?.competitors?.find(c => String(c?.team?.id) !== String(teamId));
      const selfScore = scheduleCompetitorScore(self);
      const oppScore = scheduleCompetitorScore(opp);
      if (selfScore == null || oppScore == null) continue;
      completed.push({ date: ev.date, netDiff: selfScore - oppScore });
    }
    completed.sort((a, b) => new Date(a.date) - new Date(b.date));
    const last3 = completed.slice(-3);
    const last3NetDiff = last3.length
      ? last3.reduce((s, g) => s + g.netDiff, 0) / last3.length
      : null;
    const lastGameDate = completed.length ? completed[completed.length - 1].date : null;
    const data = { last3NetDiff, lastGameDate };
    _scheduleCache.set(teamId, { data, time: Date.now() });
    return data;
  } catch {
    _scheduleCache.set(teamId, { data: null, time: Date.now() });
    return null;
  }
}

function daysRest(lastGameDate, nextGameDate) {
  if (!lastGameDate || !nextGameDate) return null;
  const ms = new Date(nextGameDate) - new Date(lastGameDate);
  if (!Number.isFinite(ms) || ms < 0) return null;
  return Math.round(ms / 86400000);
}

// ── Public API ──────────────────────────────────────────────────────────

// Pulls per-team stats for the given full team names (e.g. "Kansas City Chiefs").
// Returns a map keyed by the input name; any team that fails to resolve or fetch
// gets a neutral/null-filled entry so callers never need to null-check the shape.
export async function getNFLTeamStats(teamNames, gameCommenceTime) {
  const unique = [...new Set((teamNames || []).filter(Boolean))];
  const out = {};

  let teams = [];
  let standings = {};
  try {
    [teams, standings] = await Promise.all([fetchTeamsIndex(), fetchStandings()]);
  } catch (e) {
    console.warn("[nfl-stats] teams/standings fetch failed:", e.message);
  }

  await Promise.all(unique.map(async (name) => {
    const team = matchTeam(teams, name);
    if (!team) {
      out[name] = neutralEntry();
      return;
    }
    const record = standings[team.id] || {};
    const [statistics, schedule] = await Promise.all([
      fetchTeamStatistics(team.id),
      fetchTeamSchedule(team.id),
    ]);
    const gamesPlayed = record.gamesPlayed || 0;
    out[name] = {
      teamId: team.id,
      wins: record.wins ?? 0,
      losses: record.losses ?? 0,
      ties: record.ties ?? 0,
      pointsFor: record.pointsFor ?? null,
      pointsAgainst: record.pointsAgainst ?? null,
      pointsForPerGame: (record.pointsFor != null && gamesPlayed) ? record.pointsFor / gamesPlayed : null,
      pointsAgainstPerGame: (record.pointsAgainst != null && gamesPlayed) ? record.pointsAgainst / gamesPlayed : null,
      yardsPerPlay: statistics?.yardsPerPlay ?? null,
      last3NetDiff: schedule?.last3NetDiff ?? null,
      daysRest: daysRest(schedule?.lastGameDate, gameCommenceTime),
    };
  }));

  return out;
}

// ── Final scores / game status for a given CT date — used by the resolve cron ────

// Fetches NFL games on a given YYYY-MM-DD (Central time) date via ESPN's scoreboard
// endpoint. Filters events client-side to the requested date rather than trusting
// the `dates` query param alone, since this is an undocumented API and NFL scoreboard
// responses can return a whole week's slate depending on how ESPN interprets the param.
export async function getNFLGamesForDate(date) {
  const espnDate = date.replace(/-/g, "");
  try {
    const res = await fetch(`${ESPN_SCOREBOARD}?dates=${espnDate}`);
    if (!res.ok) return [];
    const json = await res.json();
    const events = json?.events || [];

    const ctFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
    });
    const ctDateOf = (iso) => {
      const p = ctFormatter.formatToParts(new Date(iso));
      return `${p.find(x => x.type === "year").value}-${p.find(x => x.type === "month").value}-${p.find(x => x.type === "day").value}`;
    };

    return events
      .filter(ev => ctDateOf(ev.date) === date)
      .map(ev => {
        const comp = ev?.competitions?.[0];
        const home = comp?.competitors?.find(c => c?.homeAway === "home");
        const away = comp?.competitors?.find(c => c?.homeAway === "away");
        return {
          id: ev.id,
          completed: !!comp?.status?.type?.completed,
          homeTeam: home?.team?.displayName || null,
          awayTeam: away?.team?.displayName || null,
          homeScore: scheduleCompetitorScore(home),
          awayScore: scheduleCompetitorScore(away),
        };
      })
      .filter(g => g.homeTeam && g.awayTeam);
  } catch (e) {
    console.warn("[nfl-stats] scoreboard fetch failed:", e.message);
    return [];
  }
}

function neutralEntry() {
  return {
    teamId: null, wins: 0, losses: 0, ties: 0,
    pointsFor: null, pointsAgainst: null,
    pointsForPerGame: null, pointsAgainstPerGame: null,
    yardsPerPlay: null, last3NetDiff: null, daysRest: null,
  };
}
