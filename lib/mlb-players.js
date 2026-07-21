/**
 * lib/mlb-players.js
 *
 * MLB player search + detail pages, via MLB Stats API (statsapi.mlb.com),
 * the same public, auth-free source the rest of the MLB pipeline uses.
 *
 * Search is a roster crawl + in-memory name index, NOT the `people/search`
 * endpoint — that endpoint turned out to return nothing in production (never
 * verified, and evidently wrong/blocked). This mirrors lib/nfl-roster.js's
 * buildPlayerIndex() pattern and reuses only proven endpoints: getMLBTeams()
 * (already used by the team-homepage feature) and `teams/{id}/roster`
 * (already used by buildMLBTeam's roster tab). Detail fetches below
 * (`people/{id}`, `people/{id}/stats`) are also already proven — they're the
 * same calls app/api/mlb/route.js's fetchPitcherHand()/fetchPitcherStats()
 * use successfully for the moneyline model.
 */

import { createClient } from "@supabase/supabase-js";
import { getMLBTeams } from "./team-list.js";

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const MLB = "https://statsapi.mlb.com/api/v1";
const CURRENT_SEASON = new Date().getFullYear();
const ROSTER_INDEX_TTL = 1000 * 60 * 60 * 6; // 6h, mirrors lib/nfl-roster.js

function parseIP(raw) {
  if (raw == null) return 0;
  const [w, p = "0"] = String(raw).split(".");
  return parseInt(w, 10) + parseInt(p, 10) / 3;
}

let _playerIndex = null;
let _playerIndexTime = 0;

// 40Man (not just "active") so injured/optioned players stay searchable —
// "active" alone excludes anyone on the IL or optioned to the minors, which is
// a large chunk of notable players at any given time. Falls back to "active"
// per-team if the 40Man call fails, so coverage never regresses below what
// worked before.
async function fetchRoster(teamId) {
  for (const rosterType of ["40Man", "active"]) {
    try {
      const res = await fetch(`${MLB}/teams/${teamId}/roster?rosterType=${rosterType}`, { signal: AbortSignal.timeout(5000) });
      if (res.ok) return await res.json();
    } catch { /* try next rosterType — a hung/slow team must never stall the other 29 */ }
  }
  return null;
}

// Exported so app/api/cron/player-index/route.js can build this same live
// crawl and persist it to Supabase — search itself no longer calls this
// directly (see searchMLBPlayers below).
export async function buildPlayerIndex() {
  if (_playerIndex && Date.now() - _playerIndexTime < ROSTER_INDEX_TTL) return _playerIndex;
  const teams = await getMLBTeams().catch(() => []);
  const index = new Map();
  await Promise.all(teams.map(async (team) => {
    try {
      const json = await fetchRoster(team.id);
      if (!json) return;
      for (const r of (json?.roster || [])) {
        const name = (r.person?.fullName || "").toLowerCase().trim();
        if (!name || !r.person?.id) continue;
        index.set(name, {
          id: r.person.id,
          name: r.person.fullName,
          team: team.name,
          position: r.position?.abbreviation || null,
        });
      }
    } catch { /* one team's roster failing shouldn't blank the whole index */ }
  }));
  _playerIndex = index;
  _playerIndexTime = Date.now();
  return index;
}

// Exact > full-name-starts-with > any-word-starts-with (catches last-name
// lookups like "judge") > plain substring. Without this, an arbitrary 6
// substring matches (in Map insertion order) could crowd out the actual
// player someone typed for.
function matchScore(name, q) {
  if (name === q) return 0;
  if (name.startsWith(q)) return 1;
  if (name.split(" ").some(w => w.startsWith(q))) return 2;
  if (name.includes(q)) return 3;
  return null;
}

// Reads the Supabase-cached index (refreshed every 6h by
// /api/cron/player-index) instead of live-crawling all 30 team rosters on
// every keystroke. That live crawl was a ~30-way parallel fetch fan-out to
// statsapi.mlb.com rebuilt from scratch on every cold serverless instance —
// a single slow/blocked host there made search return nothing, with no
// external call at request time left to fail. A full-sport select is cheap
// (well under 1,000 rows) so ranking happens in JS exactly as before.
export async function searchMLBPlayers(query, limit = 8) {
  const q = (query || "").toLowerCase().trim();
  if (q.length < 2) return [];
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("player_index")
      .select("player_id, name, name_lower, team, position")
      .eq("sport", "mlb");
    if (error || !data) return [];
    const scored = [];
    for (const row of data) {
      const score = matchScore(row.name_lower, q);
      if (score !== null) {
        scored.push({ score, row, player: { id: Number(row.player_id), name: row.name, team: row.team, position: row.position } });
      }
    }
    scored.sort((a, b) => a.score - b.score || a.row.name_lower.localeCompare(b.row.name_lower));
    return scored.slice(0, limit).map(s => s.player);
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
  // 162 covers a full season's worth of starts/games — the Prop Lines tab
  // needs the whole season to compute a meaningful hit-rate-per-line
  // breakdown; the Game Log tab (recent games only) slices this down client-side.
  const gameLog = await fetchGameLog(id, group, 162);

  return {
    sport: "mlb",
    ...bio,
    seasonStatGroup: group,
    seasonStats: seasonStats?.stat || null,
    gameLog,
  };
}
