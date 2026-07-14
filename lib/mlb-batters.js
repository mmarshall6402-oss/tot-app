/**
 * lib/mlb-batters.js
 *
 * Per-batter season stats + handedness from MLB Stats API (statsapi.mlb.com),
 * the same public, auth-free source app/api/mlb/route.js already uses for
 * pitchers. Powers the batter home-run prop model (lib/prop-probability.js).
 *
 * Only called for confirmed starting-lineup batter IDs (~18/game), never for
 * full rosters — call volume stays bounded to a full MLB slate.
 */

const MLB = "https://statsapi.mlb.com/api/v1";

const _statsCache = new Map(); // batterId -> { data, ts }
const _handCache = new Map();  // batterId -> { data, ts }
const TTL = 1000 * 60 * 60 * 4; // 4 hours

export async function fetchBatterSeasonStats(batterId, year = new Date().getFullYear()) {
  if (!batterId) return null;
  const key = `${batterId}:${year}`;
  const hit = _statsCache.get(key);
  if (hit && Date.now() - hit.ts < TTL) return hit.data;

  try {
    const res = await fetch(`${MLB}/people/${batterId}/stats?stats=season&group=hitting&season=${year}`);
    const json = await res.json();
    const stat = json?.stats?.[0]?.splits?.[0]?.stat;
    const data = stat && stat.plateAppearances != null ? {
      homeRuns:         parseInt(stat.homeRuns || 0, 10),
      plateAppearances: parseInt(stat.plateAppearances || 0, 10),
      atBats:           parseInt(stat.atBats || 0, 10),
      avg:              stat.avg ?? null,
    } : null;
    _statsCache.set(key, { data, ts: Date.now() });
    return data;
  } catch {
    return null;
  }
}

export async function fetchBatterHandAndOrder(batterId) {
  if (!batterId) return null;
  const hit = _handCache.get(batterId);
  if (hit && Date.now() - hit.ts < TTL) return hit.data;

  try {
    const res = await fetch(`${MLB}/people/${batterId}`);
    const json = await res.json();
    const person = json?.people?.[0];
    const data = person ? {
      fullName: person.fullName ?? null,
      hand:     person.batSide?.code ?? null, // "L" | "R" | "S" (switch)
    } : null;
    _handCache.set(batterId, { data, ts: Date.now() });
    return data;
  } catch {
    return null;
  }
}

// Batch fetch — only for the batter IDs a posted lineup actually contains.
export async function fetchBattersForLineup(batterIds, year = new Date().getFullYear()) {
  const ids = (batterIds || []).filter(Boolean);
  const results = await Promise.all(ids.map(async (id, i) => {
    const [stats, handInfo] = await Promise.all([
      fetchBatterSeasonStats(id, year),
      fetchBatterHandAndOrder(id),
    ]);
    if (!stats || !handInfo) return null;
    return {
      id,
      name: handInfo.fullName,
      hand: handInfo.hand,
      battingOrder: i + 1, // homeLineupIds/awayLineupIds preserve batting-order
      homeRuns: stats.homeRuns,
      plateAppearances: stats.plateAppearances,
      hrRate: stats.plateAppearances > 0 ? stats.homeRuns / stats.plateAppearances : null,
    };
  }));
  return results.filter(Boolean);
}
