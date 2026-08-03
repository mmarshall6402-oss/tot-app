// Sleeper's public API (api.sleeper.app/v1) — free, no key, read-only. Same
// role for fantasy-draft live signal as lib/nfl-roster.js plays for ESPN
// roster/injury data: cache aggressively, degrade to null/[] on any failure,
// never let a live-enrichment miss block ranking computation.
//
// Sleeper's own docs ask that the full player map be fetched at most once a
// day (it's a ~5MB response), hence the long TTL here.

const SLEEPER_BASE = "https://api.sleeper.app/v1";
const PLAYER_INDEX_TTL = 1000 * 60 * 60 * 24;

let _playerIndex = null;
let _playerIndexTime = 0;

function toEntry(id, p) {
  return {
    sleeperId: id,
    espnId: p?.espn_id ? String(p.espn_id) : null,
    name: p?.full_name || [p?.first_name, p?.last_name].filter(Boolean).join(" ") || null,
    position: p?.position || null,
    team: p?.team || null,
    depthChartPosition: p?.depth_chart_position ?? null,
    depthChartOrder: p?.depth_chart_order ?? null,
    injuryStatus: p?.injury_status || null,
    practiceParticipation: p?.practice_participation || null,
  };
}

// Returns a Map keyed by Sleeper player_id. Cached in-memory for
// PLAYER_INDEX_TTL — callers needing an espn_id lookup should build their own
// secondary index from this (see buildEspnIdIndex below) rather than
// refetching.
export async function fetchSleeperPlayerIndex() {
  if (_playerIndex && Date.now() - _playerIndexTime < PLAYER_INDEX_TTL) return _playerIndex;
  try {
    const res = await fetch(`${SLEEPER_BASE}/players/nfl`, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`Sleeper players ${res.status}`);
    const json = await res.json();
    const index = new Map();
    for (const [id, p] of Object.entries(json || {})) {
      index.set(id, toEntry(id, p));
    }
    _playerIndex = index;
    _playerIndexTime = Date.now();
    return index;
  } catch (e) {
    console.warn("[sleeper] player index fetch failed:", e.message);
    return _playerIndex || new Map(); // serve stale cache over nothing, if we have it
  }
}

// Secondary index for joining by espn_id (the crosswalk key used throughout
// lib/nfl-fantasy/*). Entries without an espn_id are skipped.
export function buildEspnIdIndex(sleeperIndex) {
  const byEspnId = new Map();
  for (const entry of sleeperIndex.values()) {
    if (entry.espnId) byEspnId.set(entry.espnId, entry);
  }
  return byEspnId;
}

export async function fetchTrendingAdds({ lookbackHours = 24, limit = 25 } = {}) {
  try {
    const res = await fetch(
      `${SLEEPER_BASE}/players/nfl/trending/add?lookback_hours=${lookbackHours}&limit=${limit}`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (!res.ok) throw new Error(`Sleeper trending ${res.status}`);
    const json = await res.json();
    return (json || []).map((row) => ({ sleeperId: row.player_id, count: row.count }));
  } catch (e) {
    console.warn("[sleeper] trending adds fetch failed:", e.message);
    return [];
  }
}

// The league-connect endpoints below are small, per-action lookups (a user
// typing their username, then picking a league) — unlike the full player
// map there's no "fetch at most once a day" guidance from Sleeper for these,
// so no caching here; each is fetched fresh on demand.

// Sleeper returns the bare string "null" (not a 404) for an unknown
// username — that deserializes to JS null, which the `|| null` below
// already handles as a clean miss.
export async function fetchSleeperUserByUsername(username) {
  try {
    const res = await fetch(`${SLEEPER_BASE}/user/${encodeURIComponent(username)}`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`Sleeper user ${res.status}`);
    const json = await res.json();
    if (!json?.user_id) return null;
    return { sleeperUserId: json.user_id, username: json.username, displayName: json.display_name || json.username, avatar: json.avatar || null };
  } catch (e) {
    console.warn("[sleeper] user lookup failed:", e.message);
    return null;
  }
}

export async function fetchUserLeagues(sleeperUserId, season) {
  try {
    const res = await fetch(`${SLEEPER_BASE}/user/${sleeperUserId}/leagues/nfl/${season}`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`Sleeper leagues ${res.status}`);
    const json = await res.json();
    return (json || []).map((l) => ({
      leagueId: l.league_id,
      name: l.name,
      season: l.season,
      totalRosters: l.total_rosters,
      avatar: l.avatar || null,
    }));
  } catch (e) {
    console.warn("[sleeper] user leagues fetch failed:", e.message);
    return [];
  }
}

export async function fetchLeague(leagueId) {
  try {
    const res = await fetch(`${SLEEPER_BASE}/league/${leagueId}`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`Sleeper league ${res.status}`);
    const json = await res.json();
    if (!json?.league_id) return null;
    return { leagueId: json.league_id, name: json.name, season: json.season, totalRosters: json.total_rosters };
  } catch (e) {
    console.warn("[sleeper] league fetch failed:", e.message);
    return null;
  }
}

export async function fetchLeagueRosters(leagueId) {
  try {
    const res = await fetch(`${SLEEPER_BASE}/league/${leagueId}/rosters`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`Sleeper rosters ${res.status}`);
    const json = await res.json();
    return (json || []).map((r) => ({
      rosterId: r.roster_id,
      ownerId: r.owner_id,
      players: r.players || [],
      starters: r.starters || [],
    }));
  } catch (e) {
    console.warn("[sleeper] league rosters fetch failed:", e.message);
    return [];
  }
}

export async function fetchLeagueUsers(leagueId) {
  try {
    const res = await fetch(`${SLEEPER_BASE}/league/${leagueId}/users`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`Sleeper league users ${res.status}`);
    const json = await res.json();
    return (json || []).map((u) => ({
      sleeperUserId: u.user_id,
      displayName: u.display_name,
      teamName: u.metadata?.team_name || u.display_name,
    }));
  } catch (e) {
    console.warn("[sleeper] league users fetch failed:", e.message);
    return [];
  }
}
