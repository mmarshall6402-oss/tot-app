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

// Draft state for the On-The-Clock assistant (components/NFLSection.js's
// "Draft" mode) — Sleeper's draft endpoints are public/no-key for any draft
// whose id you have, same as everything else in this file. Unlike
// fetchSleeperPlayerIndex, these are never cached: a live draft is exactly
// the kind of data that's stale the moment it's fetched, and the caller
// polls this on its own interval.
export async function fetchDraft(draftId) {
  try {
    const res = await fetch(`${SLEEPER_BASE}/draft/${draftId}`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`Sleeper draft ${res.status}`);
    return await res.json();
  } catch (e) {
    console.warn("[sleeper] draft fetch failed:", e.message);
    return null;
  }
}

// Returns picks made so far, oldest first — Sleeper doesn't include
// not-yet-made picks in this response, so picks.length + 1 is the next
// (current) overall pick number.
export async function fetchDraftPicks(draftId) {
  try {
    const res = await fetch(`${SLEEPER_BASE}/draft/${draftId}/picks`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`Sleeper draft picks ${res.status}`);
    return (await res.json()) || [];
  } catch (e) {
    console.warn("[sleeper] draft picks fetch failed:", e.message);
    return [];
  }
}

// Resolves a Sleeper username to a user_id — lets the Draft Assistant's
// Sleeper Sync mode auto-detect which slot is "yours" from a username
// instead of making the user hunt down and type a numeric slot themselves.
export async function fetchSleeperUser(username) {
  const trimmed = (username || "").trim();
  if (!trimmed) return null;
  try {
    const res = await fetch(`${SLEEPER_BASE}/user/${encodeURIComponent(trimmed)}`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const json = await res.json();
    if (!json?.user_id) return null;
    return { userId: json.user_id, username: json.username || trimmed, displayName: json.display_name || json.username || trimmed };
  } catch (e) {
    console.warn("[sleeper] user fetch failed:", e.message);
    return null;
  }
}

// Every draft (league drafts, mocks) a Sleeper user is part of for a given
// season — lets Sleeper Sync offer "here are your drafts, pick one" instead
// of requiring the user to dig up and paste a draft URL themselves.
export async function fetchSleeperUserDrafts(userId, season) {
  try {
    const res = await fetch(`${SLEEPER_BASE}/user/${userId}/drafts/nfl/${season}`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`Sleeper user drafts ${res.status}`);
    return (await res.json()) || [];
  } catch (e) {
    console.warn("[sleeper] user drafts fetch failed:", e.message);
    return [];
  }
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
