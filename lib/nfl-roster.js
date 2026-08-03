// ESPN hidden API player/roster lookup for fantasy-tool grounding — same unofficial
// site.api.espn.com family and defensive-parse posture as lib/nfl-stats.js: every
// lookup degrades to null on any shape mismatch or fetch failure rather than
// throwing, so app/api/nfl/fantasy/route.js can always fall back to Claude's own
// player knowledge when a name can't be resolved.

import { createClient } from "@supabase/supabase-js";

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";
const TEAMS_TTL = 1000 * 60 * 60 * 12;
const ROSTER_INDEX_TTL = 1000 * 60 * 60 * 6; // injury designations shift during the week

let _teamsCache = null;
let _teamsCacheTime = 0;

async function fetchTeamsIndex() {
  if (_teamsCache && Date.now() - _teamsCacheTime < TEAMS_TTL) return _teamsCache;
  const res = await fetch(`${ESPN_BASE}/teams?limit=40`, { signal: AbortSignal.timeout(5000) });
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

// Exported so app/api/cron/player-index/route.js can build this same live
// crawl and persist it to Supabase — search itself no longer calls this
// directly (see searchNFLPlayers below). Still used as-is by
// lookupNFLPlayer/findMentionedNFLPlayers for the fantasy-tool feature.
export async function buildPlayerIndex() {
  if (_playerIndex && Date.now() - _playerIndexTime < ROSTER_INDEX_TTL) return _playerIndex;
  const teams = await fetchTeamsIndex().catch(() => []);
  const index = new Map();
  await Promise.all(teams.map(async (team) => {
    try {
      const res = await fetch(`${ESPN_BASE}/teams/${team.id}/roster`, { signal: AbortSignal.timeout(5000) });
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

// Reads the Supabase-cached index (refreshed every 6h by
// /api/cron/player-index) instead of live-crawling all 32 team rosters on
// every keystroke. That live crawl was a ~32-way parallel fetch fan-out to
// ESPN's hidden API rebuilt from scratch on every cold serverless instance —
// a single slow/blocked host there made search return nothing, with no
// external call at request time left to fail. A full-sport select is cheap
// (well under 2,000 rows) so ranking happens in JS exactly as before.
export async function searchNFLPlayers(query, limit = 8) {
  const q = (query || "").toLowerCase().trim();
  if (q.length < 2) return [];
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("player_index")
      .select("player_id, name, name_lower, team, position, injury_status")
      .eq("sport", "nfl");
    if (error || !data) return [];
    const scored = [];
    for (const row of data) {
      const score = matchScore(row.name_lower, q);
      if (score !== null) {
        scored.push({ score, row, player: { id: row.player_id, name: row.name, team: row.team, position: row.position, injuryStatus: row.injury_status } });
      }
    }
    scored.sort((a, b) => a.score - b.score || a.row.name_lower.localeCompare(b.row.name_lower));
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

// SportsData.io enrichment — was configured (SPORTSDATA_API_KEY is checked
// for presence in app/api/debug/route.js) but never actually called anywhere
// in this app. It's a documented, paid NFL feed, so where the ESPN "common"
// endpoint above is a guess, this fills in richer bio fields and real
// per-game stats when the key is present — while ESPN stays the required
// primary source, since it's the only thing that can resolve the ESPN
// athlete ID this app's search/player_index actually stores.
//
// SportsData.io's own PlayerID space has nothing to do with ESPN's athlete
// IDs, so the only way to line a player up across providers is by name —
// same posture as lookupNFLPlayer()'s name matching below, just against a
// second roster. UNVERIFIED against a live call (outbound access to
// api.sportsdata.io isn't reachable from this sandbox) — confirm the field
// names below against one real response before fully trusting this; any
// failure or shape mismatch just leaves the ESPN-derived fields in place.
const SPORTSDATA_KEY = process.env.SPORTSDATA_API_KEY;
const SPORTSDATA_BASE = "https://api.sportsdata.io/v3/nfl";
const SPORTSDATA_INDEX_TTL = 1000 * 60 * 60 * 12;

let _sportsDataIndex = null;
let _sportsDataIndexTime = 0;

async function fetchSportsDataIndex() {
  if (!SPORTSDATA_KEY) return null;
  if (_sportsDataIndex && Date.now() - _sportsDataIndexTime < SPORTSDATA_INDEX_TTL) return _sportsDataIndex;
  try {
    const res = await fetch(`${SPORTSDATA_BASE}/scores/json/Players?key=${SPORTSDATA_KEY}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const json = await res.json();
    if (!Array.isArray(json)) return null;
    const index = new Map();
    for (const p of json) {
      const name = (p?.Name || `${p?.FirstName || ""} ${p?.LastName || ""}`).toLowerCase().trim();
      if (!name || p?.PlayerID == null) continue;
      index.set(name, p);
    }
    _sportsDataIndex = index;
    _sportsDataIndexTime = Date.now();
    return index;
  } catch (e) {
    console.warn("[nfl-roster] SportsData player index failed:", e.message);
    return null;
  }
}

function findSportsDataPlayer(index, name) {
  const q = (name || "").toLowerCase().trim();
  if (!q || !index) return null;
  if (index.has(q)) return index.get(q);
  const lastWord = q.split(" ").pop();
  for (const [n, p] of index) {
    if (n.split(" ").pop() === lastWord) return p;
  }
  return null;
}

// SportsData.io's per-game/season rows carry ~150 fields — keep only the
// ones with a real (non-zero) value, same generic label/value contract
// PlayerModal already renders via statEntries(). Zero is treated as "not
// this player's stat category" rather than a real 0-for-the-game, since a
// cross-position stat row (passing + rushing + receiving all in one object)
// would otherwise bury the relevant handful of numbers under a wall of
// zeroes from categories that don't apply to this player.
const SPORTSDATA_STAT_KEYS = [
  "PassingYards", "PassingTouchdowns", "PassingInterceptions", "PassingCompletions", "PassingAttempts", "PassingRating",
  "RushingYards", "RushingTouchdowns", "RushingAttempts",
  "ReceivingYards", "ReceivingTouchdowns", "Receptions", "Targets",
  "FumblesLost", "SoloTackles", "Sacks", "Interceptions",
  "FantasyPoints", "FantasyPointsPPR",
];
function statFieldsFromSportsData(row) {
  const out = {};
  for (const key of SPORTSDATA_STAT_KEYS) {
    const val = row?.[key];
    if (val != null && val !== 0) out[key] = val;
  }
  return out;
}

async function fetchSportsDataDetail(sdPlayerId) {
  const season = new Date().getFullYear();
  try {
    const [seasonRes, gamesRes] = await Promise.all([
      fetch(`${SPORTSDATA_BASE}/stats/json/PlayerSeasonStatsByPlayerID/${season}/${sdPlayerId}?key=${SPORTSDATA_KEY}`, { signal: AbortSignal.timeout(8000) }),
      fetch(`${SPORTSDATA_BASE}/stats/json/PlayerGameStatsBySeason/${season}/${sdPlayerId}/10?key=${SPORTSDATA_KEY}`, { signal: AbortSignal.timeout(8000) }),
    ]);
    const seasonJson = seasonRes.ok ? await seasonRes.json() : null;
    const seasonRow = Array.isArray(seasonJson) ? seasonJson[0] : seasonJson;
    const gamesJson = gamesRes.ok ? await gamesRes.json() : [];
    return {
      seasonStats: seasonRow ? statFieldsFromSportsData(seasonRow) : null,
      gameLog: (Array.isArray(gamesJson) ? gamesJson : []).slice(-10).reverse().map(g => ({
        date: g.Date || g.DateTime || null,
        opponent: g.Opponent || null,
        isHome: g.HomeOrAway ? g.HomeOrAway === "HOME" : null,
        stat: statFieldsFromSportsData(g),
      })),
    };
  } catch (e) {
    console.warn("[nfl-roster] SportsData detail fetch failed:", e.message);
    return null;
  }
}

// Overlays SportsData.io bio/stats onto an ESPN-derived detail object, in
// place, when the key is set and the player can be name-matched. Never
// throws — any failure just leaves the ESPN fields as they were.
async function enrichWithSportsData(detail) {
  if (!SPORTSDATA_KEY || !detail?.name) return;
  try {
    const index = await fetchSportsDataIndex();
    const sdPlayer = findSportsDataPlayer(index, detail.name);
    if (sdPlayer?.PlayerID == null) return;

    detail.college = detail.college || sdPlayer.College || null;
    detail.age = detail.age ?? (Number.isFinite(sdPlayer.Age) ? sdPlayer.Age : null);
    detail.experience = detail.experience ?? (Number.isFinite(sdPlayer.Experience) ? sdPlayer.Experience : null);
    detail.birthDate = detail.birthDate || sdPlayer.BirthDate || null;
    detail.injuryStatus = sdPlayer.InjuryStatus || detail.injuryStatus || null;
    if (!detail.draft && (sdPlayer.DraftYear || sdPlayer.DraftRound)) {
      detail.draft = { year: sdPlayer.DraftYear ?? null, round: sdPlayer.DraftRound ?? null, selection: sdPlayer.DraftPick ?? null, text: null };
    }

    const extra = await fetchSportsDataDetail(sdPlayer.PlayerID);
    if (extra?.seasonStats && Object.keys(extra.seasonStats).length) {
      detail.seasonStats = { ...detail.seasonStats, ...extra.seasonStats };
    }
    if (extra?.gameLog?.length) detail.gameLog = extra.gameLog;
  } catch (e) {
    console.warn("[nfl-roster] SportsData enrichment failed:", e.message);
  }
}

// Gamelog categories carry parallel `labels` (stat names) and per-event
// `stats` (values at the same index) rather than MLB's ready-made label/value
// object — zip them per event, then attach date/opponent from the event map.
// Any shape mismatch degrades to an empty stat object per game rather than
// throwing, same posture as the rest of this file.
function parseNFLGameLog(glJson, limit = 10) {
  const eventsMeta = glJson?.events || {};
  const seasonTypes = glJson?.seasonTypes || [];
  const statsByEvent = new Map();

  for (const st of seasonTypes) {
    for (const cat of (st?.categories || [])) {
      const labels = cat?.labels || cat?.displayNames || [];
      for (const ev of (cat?.events || [])) {
        const eventId = ev?.eventId;
        if (!eventId) continue;
        const stat = statsByEvent.get(eventId) || {};
        (ev.stats || []).forEach((val, i) => {
          const label = labels[i];
          if (label != null && val != null && val !== "") stat[label] = val;
        });
        statsByEvent.set(eventId, stat);
      }
    }
  }

  const rows = Object.entries(eventsMeta).map(([eventId, meta]) => ({
    date: meta?.gameDate || meta?.date || null,
    opponent: meta?.opponent?.displayName || meta?.opponent?.abbreviation || null,
    isHome: meta?.atVs ? meta.atVs !== "@" : null,
    stat: statsByEvent.get(eventId) || {},
  }));

  rows.sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
  return rows.slice(-limit).reverse();
}

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
        gameLog = parseNFLGameLog(glJson);
      }
    } catch { /* game log is best-effort */ }

    const draft = athlete.draft;

    const detail = {
      sport: "nfl",
      id: athlete.id,
      name: athlete.displayName || athlete.fullName,
      position: athlete.position?.abbreviation || null,
      team: athlete.team?.displayName || null,
      jersey: athlete.jersey || null,
      height: athlete.displayHeight || null,
      weight: athlete.displayWeight || null,
      headshot: athlete.headshot?.href || null,
      birthDate: athlete.dateOfBirth || null,
      age: athlete.age ?? null,
      college: athlete.college?.name || null,
      experience: athlete.experience?.years ?? null,
      draft: draft ? {
        year: draft.year ?? null,
        round: draft.round ?? null,
        selection: draft.selection ?? null,
        text: draft.displayText || null,
      } : null,
      injuryStatus: athlete.injuries?.[0]?.status || null,
      seasonStats,
      gameLog,
    };

    await enrichWithSportsData(detail);
    return detail;
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
