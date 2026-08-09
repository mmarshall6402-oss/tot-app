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

// ── League sync (user -> leagues -> rosters -> draft) ──
// Unlike the player index above, these are per-user, small responses with no
// reason to cache across requests — always fetch fresh so a roster move or a
// live draft pick shows up immediately. Each throws on failure (unlike the
// functions above) since the caller is a request handler that should turn a
// Sleeper outage into a 502, not silently show an empty roster.

async function sleeperGet(path) {
  const res = await fetch(`${SLEEPER_BASE}${path}`, { signal: AbortSignal.timeout(10000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Sleeper ${path} ${res.status}`);
  return res.json();
}

// Sleeper usernames are case-insensitive and returns null (not a throw) for
// "no such user" so callers can show a friendly "username not found".
export async function fetchSleeperUserByUsername(username) {
  const json = await sleeperGet(`/user/${encodeURIComponent(username)}`);
  if (!json) return null;
  return { sleeperUserId: json.user_id, username: json.username, displayName: json.display_name || json.username, avatar: json.avatar || null };
}

export async function fetchUserLeagues(sleeperUserId, season) {
  const json = await sleeperGet(`/user/${encodeURIComponent(sleeperUserId)}/leagues/nfl/${season}`);
  return (json || []).map((l) => ({
    leagueId: l.league_id,
    name: l.name,
    season: l.season,
    totalRosters: l.total_rosters,
    status: l.status, // pre_draft | drafting | in_season | complete
    scoringSettings: l.scoring_settings || {},
    avatar: l.avatar || null,
  }));
}

export async function fetchLeague(leagueId) {
  const json = await sleeperGet(`/league/${encodeURIComponent(leagueId)}`);
  if (!json) return null;
  return {
    leagueId: json.league_id,
    name: json.name,
    season: json.season,
    status: json.status,
    scoringSettings: json.scoring_settings || {},
    rosterPositions: json.roster_positions || [],
  };
}

export async function fetchLeagueRosters(leagueId) {
  const json = await sleeperGet(`/league/${encodeURIComponent(leagueId)}/rosters`);
  return (json || []).map((r) => ({
    rosterId: r.roster_id,
    ownerId: r.owner_id,
    players: r.players || [],
    starters: r.starters || [],
    reserve: r.reserve || [],
    taxi: r.taxi || [],
    wins: r.settings?.wins ?? null,
    losses: r.settings?.losses ?? null,
    ties: r.settings?.ties ?? null,
    fpts: r.settings?.fpts != null ? Number(`${r.settings.fpts}.${r.settings.fpts_decimal || 0}`) : null,
  }));
}

export async function fetchLeagueUsers(leagueId) {
  const json = await sleeperGet(`/league/${encodeURIComponent(leagueId)}/users`);
  return (json || []).map((u) => ({
    sleeperUserId: u.user_id,
    displayName: u.display_name,
    teamName: u.metadata?.team_name || u.display_name,
    avatar: u.avatar || null,
  }));
}

// A league can have more than one draft (e.g. re-drafts); most recent first.
export async function fetchLeagueDrafts(leagueId) {
  const json = await sleeperGet(`/league/${encodeURIComponent(leagueId)}/drafts`);
  return (json || [])
    .map((d) => ({
      draftId: d.draft_id,
      status: d.status, // pre_draft | drafting | complete
      type: d.type, // snake | linear | auction
      rounds: d.settings?.rounds ?? null,
      startTime: d.start_time || null,
      draftOrder: d.draft_order || {}, // { sleeperUserId: slot }
    }))
    .sort((a, b) => (b.startTime || 0) - (a.startTime || 0));
}

export async function fetchDraftPicks(draftId) {
  const json = await sleeperGet(`/draft/${encodeURIComponent(draftId)}/picks`);
  return (json || []).map((p) => ({
    pickNo: p.pick_no,
    round: p.round,
    rosterId: p.roster_id,
    pickedBy: p.picked_by,
    sleeperPlayerId: p.player_id,
    isKeeper: !!p.is_keeper,
  }));
}

// Which draft-order slot (1-indexed, matching draft_order's values) is on
// the clock for a given overall pick number. Snake drafts reverse direction
// each round; linear drafts don't. Auction drafts have no fixed order, so
// callers should skip this for type === "auction".
export function pickSlotForNumber(pickNo, totalRosters, type) {
  if (!totalRosters) return null;
  const round = Math.ceil(pickNo / totalRosters);
  const posInRound = pickNo - (round - 1) * totalRosters; // 1..totalRosters
  if (type === "linear") return posInRound;
  const reverse = round % 2 === 0;
  return reverse ? totalRosters - posInRound + 1 : posInRound;
}

// Sleeper's scoring_settings is a flat map of stat -> points (e.g. rec: 1,
// rec_yd: 0.1, pass_td: 4). We only need enough of it to pick which of our
// three precomputed nfl_fantasy_rankings scoring_format rows to join
// against — reception points is the whole distinction between them.
export function deriveScoringFormat(scoringSettings) {
  const rec = Number(scoringSettings?.rec ?? 0);
  if (rec >= 1) return "ppr";
  if (rec >= 0.5) return "half_ppr";
  return "standard";
}
