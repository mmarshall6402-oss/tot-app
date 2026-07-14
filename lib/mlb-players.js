/**
 * lib/mlb-players.js
 *
 * MLB player search + detail pages, via MLB Stats API (statsapi.mlb.com),
 * the same public, auth-free source the rest of the MLB pipeline uses.
 *
 * UNVERIFIED: the `people/search?names=` endpoint's exact param name and
 * response shape haven't been confirmed against a live call (this sandbox
 * can't reach statsapi.mlb.com) — validate once deployed before relying on
 * it. Parsing here is defensive (degrades to empty results, never throws)
 * so a shape mismatch fails soft instead of breaking search entirely.
 */

const MLB = "https://statsapi.mlb.com/api/v1";
const CURRENT_SEASON = new Date().getFullYear();

const SEARCH_TTL = 1000 * 60 * 5; // 5 min — live search, not a crawl
const _searchCache = new Map(); // query -> { data, ts }

function parseIP(raw) {
  if (raw == null) return 0;
  const [w, p = "0"] = String(raw).split(".");
  return parseInt(w, 10) + parseInt(p, 10) / 3;
}

export async function searchMLBPlayers(query, limit = 8) {
  const q = (query || "").trim();
  if (q.length < 2) return [];
  const key = q.toLowerCase();
  const hit = _searchCache.get(key);
  if (hit && Date.now() - hit.ts < SEARCH_TTL) return hit.data;

  try {
    const res = await fetch(`${MLB}/people/search?names=${encodeURIComponent(q)}`);
    if (!res.ok) throw new Error(`MLB people search ${res.status}`);
    const json = await res.json();
    const people = json?.people || [];
    const data = people
      .filter(p => p.active !== false)
      .slice(0, limit)
      .map(p => ({
        id: p.id,
        name: p.fullName,
        position: p.primaryPosition?.abbreviation || null,
        team: p.currentTeam?.name || null,
      }))
      .filter(p => p.id && p.name);
    _searchCache.set(key, { data, ts: Date.now() });
    return data;
  } catch (e) {
    console.warn("[mlb-players] search failed:", e.message);
    return [];
  }
}

async function fetchBio(id) {
  const res = await fetch(`${MLB}/people/${id}`);
  if (!res.ok) return null;
  const json = await res.json();
  const p = json?.people?.[0];
  if (!p) return null;
  return {
    id: p.id,
    name: p.fullName,
    position: p.primaryPosition?.abbreviation || null,
    team: p.currentTeam?.name || null,
    bats: p.batSide?.code || null,
    throws: p.pitchHand?.code || null,
    height: p.height || null,
    weight: p.weight || null,
    birthDate: p.birthDate || null,
  };
}

// Tries hitting then pitching — a player essentially never has meaningful
// stats in both, so whichever group actually has innings/PA is the real one.
async function fetchSeasonStats(id) {
  for (const group of ["hitting", "pitching"]) {
    try {
      const res = await fetch(`${MLB}/people/${id}/stats?stats=season&group=${group}&season=${CURRENT_SEASON}`);
      if (!res.ok) continue;
      const json = await res.json();
      const stat = json?.stats?.[0]?.splits?.[0]?.stat;
      const hasData = group === "hitting" ? (stat?.plateAppearances > 0) : (parseIP(stat?.inningsPitched) > 0);
      if (stat && hasData) return { group, stat };
    } catch { /* try next group */ }
  }
  return null;
}

async function fetchGameLog(id, group, limit = 10) {
  try {
    const res = await fetch(`${MLB}/people/${id}/stats?stats=gameLog&group=${group}&season=${CURRENT_SEASON}`);
    if (!res.ok) return [];
    const json = await res.json();
    const splits = json?.stats?.[0]?.splits || [];
    return splits.slice(-limit).reverse().map(s => ({
      date: s.date,
      opponent: s.opponent?.name || null,
      isHome: s.isHome ?? null,
      stat: s.stat || {},
    }));
  } catch {
    return [];
  }
}

export async function fetchMLBPlayerDetail(id) {
  if (!id) return null;
  const bio = await fetchBio(id);
  if (!bio) return null;

  const seasonStats = await fetchSeasonStats(id);
  const group = seasonStats?.group || "hitting";
  const gameLog = await fetchGameLog(id, group);

  return {
    sport: "mlb",
    ...bio,
    seasonStatGroup: group,
    seasonStats: seasonStats?.stat || null,
    gameLog,
  };
}
