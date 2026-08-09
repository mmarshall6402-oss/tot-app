// Runs weekly in-season (nflverse's aggregated CSVs typically update within
// ~24h of Monday Night Football) to keep the CURRENT season's player_stats
// and snap_counts fresh. The bulk historical downloader
// (scripts/nfl-fantasy/fetch-nflverse.js) only covers *completed* seasons —
// prior seasons don't change — and writes to data/nflverse/*.json on local
// disk, which a Vercel serverless function can't touch (read-only
// filesystem). This cron persists the current season's data to Supabase
// instead (nflverse_data_cache, sql/027).
//
// Deliberately skips the play-by-play fallback the historical script uses
// when nflverse's aggregated player_stats file is missing for a season
// (fetchSeasonViaPbp there) — that file runs 90MB+ and risks blowing this
// cron's time budget for a single week's data. If the aggregated
// current-season file isn't published yet, this run just logs and moves
// on; next week's run tries again.
import { createClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "../../../../lib/auth.js";
import { currentNflSeason } from "../../../../lib/nfl-fantasy/season.js";
import { RELEASE_BASE, fetchNflverseCsv, checkNflverseColumns } from "../../../../lib/nfl-fantasy/nflverse-csv.js";

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function upsertDataset(supabase, dataset, rows) {
  const { error } = await supabase
    .from("nflverse_data_cache")
    .upsert(
      { dataset, data: rows, row_count: rows.length, fetched_at: new Date().toISOString() },
      { onConflict: "dataset" }
    );
  if (error) throw new Error(`${dataset} upsert failed: ${error.message}`);
}

export async function GET(request) {
  const authHeader = request.headers.get("authorization")?.replace("Bearer ", "");
  if (!timingSafeEqual(authHeader, process.env.CRON_SECRET)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const season = currentNflSeason();
  const supabase = getSupabase();
  const results = {};

  // Always-current id crosswalk, not per-season.
  try {
    const playerRows = await fetchNflverseCsv(`${RELEASE_BASE}/players/players.csv`);
    checkNflverseColumns("players", playerRows);
    await upsertDataset(supabase, "players", playerRows);
    results.players = playerRows.length;
  } catch (e) {
    results.players = { error: e.message };
  }

  try {
    const statsRows = await fetchNflverseCsv(`${RELEASE_BASE}/player_stats/player_stats_${season}.csv`);
    checkNflverseColumns("player_stats", statsRows);
    await upsertDataset(supabase, `player_stats_${season}`, statsRows);
    results.playerStats = statsRows.length;
  } catch (e) {
    results.playerStats = { error: e.message, note: "aggregated file may not be published yet for this season/week" };
  }

  try {
    const snapRows = await fetchNflverseCsv(`${RELEASE_BASE}/snap_counts/snap_counts_${season}.csv`);
    checkNflverseColumns("snap_counts", snapRows);
    await upsertDataset(supabase, `snap_counts_${season}`, snapRows);
    results.snapCounts = snapRows.length;
  } catch (e) {
    results.snapCounts = { error: e.message };
  }

  return Response.json({ season, ...results });
}
