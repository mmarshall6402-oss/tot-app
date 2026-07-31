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
