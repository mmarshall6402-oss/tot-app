// ESPN hidden API player/roster lookup for fantasy-tool grounding — same unofficial
// site.api.espn.com family and defensive-parse posture as lib/nfl-stats.js: every
// lookup degrades to null on any shape mismatch or fetch failure rather than
// throwing, so app/api/nfl/fantasy/route.js can always fall back to Claude's own
// player knowledge when a name can't be resolved.

const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";
const TEAMS_TTL = 1000 * 60 * 60 * 12;
const ROSTER_INDEX_TTL = 1000 * 60 * 60 * 6; // injury designations shift during the week

let _teamsCache = null;
let _teamsCacheTime = 0;

async function fetchTeamsIndex() {
  if (_teamsCache && Date.now() - _teamsCacheTime < TEAMS_TTL) return _teamsCache;
  const res = await fetch(`${ESPN_BASE}/teams?limit=40`);
  if (!res.ok) throw new Error(`ESPN teams ${res.status}`);
  const json = await res.json();
  const list = json?.sports?.[0]?.leagues?.[0]?.teams || [];
  const teams = list.map(t => t.team).filter(Boolean).map(t => ({ id: t.id, displayName: t.displayName }));
  _teamsCache = teams;
  _teamsCacheTime = Date.now();
  return teams;
}

// Roster response shape varies across ESPN's unofficial API versions — try the
// grouped-by-position shape first (`athletes: [{ items: [...] }]`), fall back to
// a flat list.
function extractAthletes(rosterJson) {
  const groups = rosterJson?.athletes || rosterJson?.team?.athletes || [];
  const flat = [];
  for (const group of groups) {
    const items = group?.items || (Array.isArray(group) ? group : []);
    for (const a of items) flat.push(a);
  }
  return flat;
}

function injuryStatus(athlete) {
  const inj = athlete?.injuries?.[0];
  if (inj) return inj?.status || inj?.type?.description || null;
  const statusName = athlete?.status?.type?.name || athlete?.status?.name;
  return statusName && statusName !== "Active" ? statusName : null;
}

let _playerIndex = null;
let _playerIndexTime = 0;

async function buildPlayerIndex() {
  if (_playerIndex && Date.now() - _playerIndexTime < ROSTER_INDEX_TTL) return _playerIndex;
  const teams = await fetchTeamsIndex().catch(() => []);
  const index = new Map();
  await Promise.all(teams.map(async (team) => {
    try {
      const res = await fetch(`${ESPN_BASE}/teams/${team.id}/roster`);
      if (!res.ok) return;
      const json = await res.json();
      for (const a of extractAthletes(json)) {
        const name = (a?.fullName || a?.displayName || "").toLowerCase().trim();
        if (!name) continue;
        index.set(name, {
          id: a?.id || null,
          name: a.fullName || a.displayName,
          team: team.displayName,
          teamId: team.id,
          position: a?.position?.abbreviation || null,
          injuryStatus: injuryStatus(a),
        });
      }
    } catch { /* one team's roster failing shouldn't blank out the whole index */ }
  }));
  _playerIndex = index;
  _playerIndexTime = Date.now();
  return index;
}

function bestMatch(index, query) {
  const q = (query || "").toLowerCase().trim();
  if (!q) return null;
  if (index.has(q)) return index.get(q);
  for (const [name, player] of index) {
    if (name.includes(q) || q.includes(name)) return player;
  }
  const lastWord = q.split(" ").pop();
  for (const [name, player] of index) {
    if (name.split(" ").pop() === lastWord) return player;
  }
  return null;
}

// Exact > full-name-starts-with > any-word-starts-with (catches last-name
// lookups like "mahomes") > plain substring — otherwise an arbitrary 6
// substring matches (in Map insertion order) could crowd out the player
// someone actually typed for.
function matchScore(name, q) {
  if (name === q) return 0;
  if (name.startsWith(q)) return 1;
  if (name.split(" ").some(w => w.startsWith(q))) return 2;
  if (name.includes(q)) return 3;
  return null;
}

// Multi-result ranked search over the same roster index, for the search
// overlay's autocomplete (bestMatch only returns a single best guess).
export async function searchNFLPlayers(query, limit = 8) {
  try {
    const index = await buildPlayerIndex();
    const q = (query || "").toLowerCase().trim();
    if (q.length < 2) return [];
    const scored = [];
    for (const [name, player] of index) {
      const score = matchScore(name, q);
      if (score !== null) scored.push({ score, name, player });
    }
    scored.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name));
    return scored.slice(0, limit).map(s => s.player);
  } catch (e) {
    console.warn("[nfl-roster] search failed:", e.message);
    return [];
  }
}

// UNVERIFIED: ESPN's per-athlete "common" endpoint shape hasn't been confirmed
// against a live call in this repo — no existing code fetches it. Parsed
// defensively like the rest of this file; degrade to whatever fields exist
// rather than throwing, since this is a bio/stats nice-to-have, not core data.
const ESPN_ATHLETE_BASE = "https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes";

export async function fetchNFLPlayerDetail(athleteId) {
  if (!athleteId) return null;
  try {
    const res = await fetch(`${ESPN_ATHLETE_BASE}/${athleteId}`);
    if (!res.ok) return null;
    const json = await res.json();
    const athlete = json?.athlete;
    if (!athlete) return null;

    const statCategories = json?.statistics?.splits?.categories || [];
    const seasonStats = {};
    for (const cat of statCategories) {
      for (const stat of (cat.stats || [])) {
        if (stat?.name) seasonStats[stat.name] = stat.value ?? stat.displayValue ?? null;
      }
    }

    let gameLog = [];
    try {
      const glRes = await fetch(`${ESPN_ATHLETE_BASE}/${athleteId}/gamelog`);
      if (glRes.ok) {
        const glJson = await glRes.json();
        const events = glJson?.events || {};
        gameLog = Object.values(events).slice(-10).reverse().map(ev => ({
          date: ev?.date || null,
          opponent: ev?.opponent?.displayName || null,
        }));
      }
    } catch { /* game log is best-effort */ }

    return {
      sport: "nfl",
      id: athlete.id,
      name: athlete.displayName || athlete.fullName,
      position: athlete.position?.abbreviation || null,
      team: athlete.team?.displayName || null,
      jersey: athlete.jersey || null,
      height: athlete.displayHeight || null,
      weight: athlete.displayWeight || null,
      injuryStatus: athlete.injuries?.[0]?.status || null,
      seasonStats,
      gameLog,
    };
  } catch (e) {
    console.warn("[nfl-roster] player detail failed:", e.message);
    return null;
  }
}

// Resolves a free-text player name (as typed into the fantasy tool) to real
// roster/injury context. Returns null if unresolvable or ESPN is unreachable —
// callers must degrade to Claude's own knowledge, never surface an error to the user.
export async function lookupNFLPlayer(name) {
  try {
    const index = await buildPlayerIndex();
    return bestMatch(index, name);
  } catch (e) {
    console.warn("[nfl-roster] lookup failed:", e.message);
    return null;
  }
}

// Scans freeform text (the "ask" mode's question, which doesn't have fixed player
// fields to look up) for any full player name present in the roster index. Cheap
// substring scan over an in-memory Map, not a per-name lookup, so it stays fast even
// with ~1700 rostered players. Capped since a question shouldn't need more than a
// handful of players' context.
export async function findMentionedNFLPlayers(text) {
  try {
    const index = await buildPlayerIndex();
    const lower = (text || "").toLowerCase();
    const matches = [];
    for (const [name, player] of index) {
      if (name.length > 3 && lower.includes(name)) matches.push(player);
    }
    return matches.slice(0, 6);
  } catch (e) {
    console.warn("[nfl-roster] mention scan failed:", e.message);
    return [];
  }
}

export function formatNFLPlayerContext(player) {
  if (!player) return null;
  const posTeam = `${player.name} (${player.position || "?"}, ${player.team})`;
  return `${posTeam} — injury status: ${player.injuryStatus || "none listed"}`;
}
