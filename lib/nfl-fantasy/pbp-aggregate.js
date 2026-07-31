// Computes per-player weekly stat lines from raw play-by-play, for seasons
// where nflverse hasn't published the aggregated player_stats_<season>.csv
// convenience rollup yet (confirmed gap for 2025 as of this writing — the
// season is complete and play_by_play_2025.csv exists, but the aggregated
// file doesn't). This is a real approximation of what nflverse's own
// tooling does internally to produce that file — not guaranteed to be a
// bit-for-bit match on every edge case (safeties, laterals, some
// sack-fumble attribution nuances), but sound enough for ranking purposes.
//
// Output rows match the same shape lib/nfl-fantasy/scoring.js already reads
// from the real player_stats.csv, so nothing downstream needs to know the
// difference. `position` is NOT set here — pbp rows don't reliably carry a
// player's roster position, so the caller joins it from the players.json
// crosswalk (already fetched regardless of this gap) after aggregating.
import { parseCsvColumns } from "./csv-columns.js";

const NEEDED_COLUMNS = [
  "season", "week", "posteam",
  "passer_player_id", "passer_player_name",
  "receiver_player_id", "receiver_player_name",
  "rusher_player_id", "rusher_player_name",
  "complete_pass", "pass_touchdown", "rush_touchdown", "interception",
  "passing_yards", "receiving_yards", "rushing_yards",
  "fumble_lost", "fumbled_1_player_id",
  "two_point_attempt", "two_point_conv_result",
];

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function flag(v) {
  return v === "1" || v === 1 || v === "TRUE" || v === "true";
}

function getOrCreate(map, playerId, name, team, season, week) {
  const key = `${playerId}|${season}|${week}`;
  let row = map.get(key);
  if (!row) {
    row = {
      player_id: playerId,
      player_display_name: name || null,
      recent_team: team || null,
      season: Number(season),
      week: Number(week),
      passing_yards: 0, passing_tds: 0, passing_interceptions: 0,
      rushing_yards: 0, rushing_tds: 0,
      receptions: 0, receiving_yards: 0, receiving_tds: 0,
      fumbles_lost: 0,
      passing_2pt_conversions: 0, rushing_2pt_conversions: 0, receiving_2pt_conversions: 0,
    };
    map.set(key, row);
  } else if (!row.player_display_name && name) {
    row.player_display_name = name; // fill in if an earlier touch (e.g. a fumble) created the row nameless
  }
  return row;
}

export function aggregatePlayByPlay(csvText) {
  const { rows, missingColumns } = parseCsvColumns(csvText, NEEDED_COLUMNS);
  if (missingColumns.length) {
    console.warn(`[pbp-aggregate] missing expected columns: ${missingColumns.join(", ")} — nflverse may have renamed these; those stats will be undercounted.`);
  }

  const byPlayerWeek = new Map();

  for (const r of rows) {
    if (!r.season || !r.week) continue;

    if (r.passer_player_id) {
      const p = getOrCreate(byPlayerWeek, r.passer_player_id, r.passer_player_name, r.posteam, r.season, r.week);
      p.passing_yards += num(r.passing_yards);
      if (flag(r.pass_touchdown)) p.passing_tds += 1;
      if (flag(r.interception)) p.passing_interceptions += 1;
      if (flag(r.two_point_attempt) && r.two_point_conv_result === "success") p.passing_2pt_conversions += 1;
    }

    if (flag(r.complete_pass) && r.receiver_player_id) {
      const rec = getOrCreate(byPlayerWeek, r.receiver_player_id, r.receiver_player_name, r.posteam, r.season, r.week);
      rec.receptions += 1;
      rec.receiving_yards += num(r.receiving_yards);
      if (flag(r.pass_touchdown)) rec.receiving_tds += 1;
      if (flag(r.two_point_attempt) && r.two_point_conv_result === "success") rec.receiving_2pt_conversions += 1;
    }

    if (r.rusher_player_id) {
      const ru = getOrCreate(byPlayerWeek, r.rusher_player_id, r.rusher_player_name, r.posteam, r.season, r.week);
      ru.rushing_yards += num(r.rushing_yards);
      if (flag(r.rush_touchdown)) ru.rushing_tds += 1;
      if (flag(r.two_point_attempt) && r.two_point_conv_result === "success") ru.rushing_2pt_conversions += 1;
    }

    if (flag(r.fumble_lost) && r.fumbled_1_player_id) {
      const f = getOrCreate(byPlayerWeek, r.fumbled_1_player_id, null, r.posteam, r.season, r.week);
      f.fumbles_lost += 1;
    }
  }

  return [...byPlayerWeek.values()];
}

// Attaches roster position from the players.json crosswalk (gsis_id-keyed,
// same id space as pbp's player-id columns). Rows with no crosswalk match
// (rare — very recent call-ups) are dropped rather than left with a null
// position, since rankings.js filters to QB/RB/WR/TE anyway.
export function attachPositions(aggregatedRows, playersRows) {
  const positionById = new Map();
  for (const p of playersRows || []) {
    if (p.gsis_id && p.position) positionById.set(p.gsis_id, p.position);
  }
  return aggregatedRows
    .map((r) => ({ ...r, position: positionById.get(r.player_id) || null }))
    .filter((r) => r.position);
}
