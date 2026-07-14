// lib/team-list.js
//
// Cached MLB/NFL team index — extracted out of app/api/team/route.js so it can
// be reused by app/api/search/route.js without re-fetching all 30/32 teams on
// every search keystroke. Team rosters change constantly; the *list of teams*
// (names/ids/divisions) barely does, so a long TTL is safe.

const MLB_API = "https://statsapi.mlb.com/api/v1";
const ESPN_NFL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";

const TEAMS_TTL = 1000 * 60 * 60 * 12; // 12h — mirrors lib/nfl-stats.js's TEAMS_TTL

const norm = (s) => (s || "").toLowerCase().trim();
const lastWord = (s) => norm(s).split(" ").pop();

let _mlbCache = null;
let _mlbCacheTime = 0;

export async function getMLBTeams() {
  if (_mlbCache && Date.now() - _mlbCacheTime < TEAMS_TTL) return _mlbCache;
  const res = await fetch(`${MLB_API}/teams?sportId=1&hydrate=division`);
  if (!res.ok) throw new Error(`MLB teams ${res.status}`);
  const json = await res.json();
  const teams = json?.teams || [];
  _mlbCache = teams;
  _mlbCacheTime = Date.now();
  return teams;
}

let _nflCache = null;
let _nflCacheTime = 0;

export async function getNFLTeams() {
  if (_nflCache && Date.now() - _nflCacheTime < TEAMS_TTL) return _nflCache;
  const res = await fetch(`${ESPN_NFL}/teams?limit=40`);
  if (!res.ok) throw new Error(`ESPN teams ${res.status}`);
  const json = await res.json();
  const list = json?.sports?.[0]?.leagues?.[0]?.teams || [];
  const teams = list.map(t => t.team).filter(Boolean);
  _nflCache = teams;
  _nflCacheTime = Date.now();
  return teams;
}

export function matchMLBTeam(teams, name) {
  const n = norm(name);
  return teams.find(t => norm(t.name) === n)
      || teams.find(t => norm(t.teamName) === n)
      || teams.find(t => lastWord(t.name) === lastWord(n))
      || null;
}

export function matchNFLTeam(teams, name) {
  const n = norm(name);
  return teams.find(t => norm(t.displayName) === n)
      || teams.find(t => norm(t.shortDisplayName) === n)
      || teams.find(t => lastWord(t.name) === lastWord(n))
      || null;
}

// Substring search across both leagues, for the search overlay — matches on
// any word in the team's display name (e.g. "yank" -> Yankees, "sox" -> both
// Red Sox and White Sox).
export function searchTeams(teams, query, sport) {
  const q = norm(query);
  if (!q) return [];
  return teams
    .filter(t => {
      const name = sport === "nfl" ? t.displayName : t.name;
      return norm(name).includes(q);
    })
    .map(t => ({
      sport,
      name: sport === "nfl" ? t.displayName : t.name,
      division: sport === "nfl" ? null : (t.division?.name || null),
    }));
}
