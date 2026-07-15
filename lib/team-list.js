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

// Search across both leagues, for the search overlay. Checks every name a fan
// might actually type — full name, nickname, abbreviation, city — not just the
// primary display name, so "NYY", "Dodgers", and "LA" all resolve (LA's teams'
// abbreviations start with "LA" even though "Los Angeles" itself doesn't
// contain that substring). Ranked so an exact/prefix hit on any field always
// outranks an unrelated team that merely contains the query as a substring.
export function searchTeams(teams, query, sport) {
  const q = norm(query);
  if (!q) return [];
  const fieldsFor = sport === "nfl"
    ? (t) => [t.displayName, t.shortDisplayName, t.name, t.abbreviation, t.location]
    : (t) => [t.name, t.teamName, t.shortName, t.abbreviation, t.locationName];

  const scored = [];
  for (const t of teams) {
    let best = null;
    for (const raw of fieldsFor(t)) {
      const f = norm(raw);
      if (!f) continue;
      let s;
      if (f === q) s = 0;
      else if (f.startsWith(q)) s = 1;
      else if (f.split(" ").some(w => w.startsWith(q))) s = 2;
      else if (f.includes(q)) s = 3;
      else continue;
      if (best === null || s < best) best = s;
    }
    if (best === null) continue;
    scored.push({
      score: best,
      team: {
        sport,
        name: sport === "nfl" ? t.displayName : t.name,
        division: sport === "nfl" ? null : (t.division?.name || null),
      },
    });
  }
  scored.sort((a, b) => a.score - b.score || a.team.name.localeCompare(b.team.name));
  return scored.map(s => s.team);
}
