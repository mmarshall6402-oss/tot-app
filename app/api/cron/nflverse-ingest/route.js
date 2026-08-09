// app/api/cron/nflverse-ingest/route.js
//
// Daily refresh of the current NFL season's nflverse data (sql/025_nflverse_
// daily_ingest.sql): stats_player, snap_counts, nextgen_stats, and the
// players id crosswalk itself. Complements scripts/nfl-fantasy/fetch-nflverse.js,
// which only pulls the last 5 *completed* seasons as a one-time/off-season
// projection baseline — this covers the in-progress season, which changes
// week to week while games are being played, so it needs to run daily
// rather than manually.
//
// Every row is joined back to players.csv (lib/nfl-fantasy/id-map.js) so
// downstream features can always start from the same gsis_id used
// everywhere else in the app. player_stats and nextgen_stats already carry
// gsis_id directly; snap_counts doesn't, so it's resolved via pfr_id first,
// then normalizeName() as a fallback — same "don't drop a real player over
// a missing crosswalk row" posture id-map.js already documents.
import { createClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "../../../../lib/auth.js";
import { buildIdCrosswalk, normalizeName } from "../../../../lib/nfl-fantasy/id-map.js";
import { RELEASE_BASE, fetchCsv, checkColumns, fetchNextgenStats, NEXTGEN_STAT_TYPES } from "../../../../lib/nfl-fantasy/nflverse-client.js";

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const CHUNK = 500;
function chunks(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Same rule used elsewhere in this codebase (app/api/cron/nfl-fantasy-rankings,
// app/api/nfl/team-schedule): NFL season "year" runs Sept-Feb, so before
// March it's still last season's playoffs/offseason.
function currentNflSeason(now = new Date()) {
  return now.getMonth() >= 2 ? now.getFullYear() : now.getFullYear() - 1;
}

async function upsertChunked(supabase, table, rows, onConflict) {
  for (const batch of chunks(rows, CHUNK)) {
    const { error } = await supabase.from(table).upsert(batch, { onConflict });
    if (error) throw new Error(`${table} upsert failed: ${error.message}`);
  }
}

async function ingestPlayers(supabase, playersRows) {
  const runStart = new Date().toISOString();
  const rows = (playersRows || [])
    .filter((r) => r.gsis_id)
    .map((r) => ({
      gsis_id: r.gsis_id,
      espn_id: r.espn_id ? String(r.espn_id) : null,
      pfr_id: r.pfr_id ? String(r.pfr_id) : null,
      name: r.display_name || r.full_name || r.merge_name || r.name || "Unknown",
      position: r.position || null,
      team: r.team || r.recent_team || null,
      updated_at: runStart,
    }));
  if (!rows.length) throw new Error("players crosswalk returned zero rows — refusing to touch existing cache");

  await upsertChunked(supabase, "nfl_fantasy_players", rows, "gsis_id");
  await supabase.from("nfl_fantasy_players").delete().lt("updated_at", runStart);
  return rows.length;
}

async function ingestStatsPlayer(supabase, season, playerStatsRows) {
  const runStart = new Date().toISOString();
  const rows = (playerStatsRows || [])
    .filter((r) => r.player_id && Number(r.season) === season)
    .map((r) => ({
      player_id: r.player_id,
      season,
      week: Number(r.week),
      name: r.player_display_name || r.player_name || null,
      position: r.position || null,
      team: r.recent_team || r.team || null,
      completions: numOrNull(r.completions),
      attempts: numOrNull(r.attempts),
      passing_yards: numOrNull(r.passing_yards),
      passing_tds: numOrNull(r.passing_tds),
      interceptions: numOrNull(r.interceptions),
      carries: numOrNull(r.carries),
      rushing_yards: numOrNull(r.rushing_yards),
      rushing_tds: numOrNull(r.rushing_tds),
      receptions: numOrNull(r.receptions),
      targets: numOrNull(r.targets),
      receiving_yards: numOrNull(r.receiving_yards),
      receiving_tds: numOrNull(r.receiving_tds),
      fantasy_points: numOrNull(r.fantasy_points),
      fantasy_points_ppr: numOrNull(r.fantasy_points_ppr),
      updated_at: runStart,
    }));

  if (!rows.length) return { rows: 0, skipped: true };

  await upsertChunked(supabase, "nfl_fantasy_stats_player", rows, "player_id,season,week");
  await supabase.from("nfl_fantasy_stats_player").delete().eq("season", season).lt("updated_at", runStart);
  return { rows: rows.length, skipped: false };
}

function numOrNull(v) {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// nflverse's snap_counts release has no gsis_id column, so each row is
// resolved through the players crosswalk via pfr_player_id first, then
// normalizeName(player) as a fallback. A row that resolves neither still
// gets written (keyed by a synthetic pfr:/name: id) rather than being
// silently dropped — the same "don't erase a real player" rule id-map.js
// documents for the espn_id side of this same crosswalk.
function ingestSnapCounts(season, snapCountsRows, crosswalk) {
  const runStart = new Date().toISOString();
  let unmatched = 0;
  const rows = (snapCountsRows || [])
    .filter((r) => Number(r.season) === season)
    .map((r) => {
      const pfrId = r.pfr_player_id || null;
      const name = r.player || null;
      let playerId = crosswalk.gsisIdForPfrId(pfrId) || (name && crosswalk.gsisIdForName(name));
      if (!playerId) {
        unmatched++;
        playerId = pfrId ? `pfr:${pfrId}` : `name:${normalizeName(name || "")}`;
      }
      return {
        player_id: playerId,
        season,
        week: Number(r.week),
        name,
        position: r.position || null,
        team: r.team || null,
        offense_snaps: numOrNull(r.offense_snaps),
        offense_pct: numOrNull(r.offense_pct),
        defense_snaps: numOrNull(r.defense_snaps),
        defense_pct: numOrNull(r.defense_pct),
        st_snaps: numOrNull(r.st_snaps),
        st_pct: numOrNull(r.st_pct),
        updated_at: runStart,
      };
    });
  return { rows, unmatched, runStart };
}

async function ingestNextgen(supabase, season, statType, crosswalk) {
  const runStart = new Date().toISOString();
  const allRows = await fetchNextgenStats(statType);
  const seasonRows = allRows.filter((r) => Number(r.season) === season);
  if (!seasonRows.length) return { rows: 0, skipped: true };

  const known = new Set(["season", "season_type", "week", "player_gsis_id", "player_display_name", "team_abbr", "player_position"]);
  const rows = seasonRows
    .filter((r) => r.player_gsis_id)
    .map((r) => {
      const metrics = {};
      for (const [k, v] of Object.entries(r)) {
        if (!known.has(k)) metrics[k] = v;
      }
      return {
        player_id: r.player_gsis_id,
        season,
        week: Number(r.week),
        stat_type: statType,
        name: r.player_display_name || null,
        team: r.team_abbr || null,
        metrics,
        updated_at: runStart,
      };
    });

  if (!rows.length) return { rows: 0, skipped: true };

  await upsertChunked(supabase, "nfl_fantasy_nextgen_stats", rows, "player_id,season,week,stat_type");
  await supabase.from("nfl_fantasy_nextgen_stats")
    .delete()
    .eq("season", season)
    .eq("stat_type", statType)
    .lt("updated_at", runStart);
  return { rows: rows.length, skipped: false };
}

export async function GET(request) {
  const authHeader = request.headers.get("authorization")?.replace("Bearer ", "");
  if (!timingSafeEqual(authHeader, process.env.CRON_SECRET)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const season = currentNflSeason();
  const supabase = getSupabase();
  const results = { season };

  let playersRows = [];
  try {
    playersRows = await fetchCsv(`${RELEASE_BASE}/players/players.csv`);
    checkColumns("players", playersRows, ["gsis_id", "espn_id", "pfr_id", "display_name", "position"]);
    results.players = await ingestPlayers(supabase, playersRows);
  } catch (e) {
    results.players = { error: e.message };
  }
  const crosswalk = buildIdCrosswalk(playersRows);

  try {
    const rows = await fetchCsv(`${RELEASE_BASE}/player_stats/player_stats_${season}.csv`);
    checkColumns("player_stats", rows, ["player_id", "player_name", "position", "recent_team", "season", "week"]);
    results.statsPlayer = await ingestStatsPlayer(supabase, season, rows);
  } catch (e) {
    results.statsPlayer = { error: e.message };
  }

  try {
    const rows = await fetchCsv(`${RELEASE_BASE}/snap_counts/snap_counts_${season}.csv`);
    checkColumns("snap_counts", rows, ["pfr_player_id", "player", "position", "team", "season", "week", "offense_pct"]);
    const { rows: snapRows, unmatched, runStart } = ingestSnapCounts(season, rows, crosswalk);
    if (snapRows.length) {
      await upsertChunked(supabase, "nfl_fantasy_snap_counts", snapRows, "player_id,season,week");
      await supabase.from("nfl_fantasy_snap_counts").delete().eq("season", season).lt("updated_at", runStart);
    }
    results.snapCounts = { rows: snapRows.length, unmatched };
  } catch (e) {
    results.snapCounts = { error: e.message };
  }

  results.nextgen = {};
  for (const statType of NEXTGEN_STAT_TYPES) {
    try {
      results.nextgen[statType] = await ingestNextgen(supabase, season, statType, crosswalk);
    } catch (e) {
      results.nextgen[statType] = { error: e.message };
    }
  }

  return Response.json(results);
}
