// app/api/cron/player-index/route.js
// Refreshes the Supabase player_index table (sql/008_player_index.sql) that
// app/api/search now reads from, replacing the old approach of live-crawling
// all ~62 MLB+NFL team rosters on every search keystroke. Runs on a schedule
// (see vercel.json) — search itself never touches statsapi.mlb.com or ESPN's
// hidden API at request time.
import { createClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "../../../../lib/auth.js";
import { buildPlayerIndex as buildMLBIndex } from "../../../../lib/mlb-players.js";
import { buildPlayerIndex as buildNFLIndex } from "../../../../lib/nfl-roster.js";

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

// Crawls one sport's live roster index and replaces that sport's rows in
// player_index. Wrapped independently per sport so an MLB-side failure (e.g.
// statsapi.mlb.com unreachable) can't block the NFL refresh, or vice versa.
async function refreshSport(supabase, sport, buildIndex, toRow) {
  const runStart = new Date().toISOString();
  const index = await buildIndex();
  // Skip entries with no id (NFL athletes occasionally lack one) — they'd all
  // collide on the same (sport, "null") primary key otherwise.
  const rows = [...index.values()]
    .filter(p => p.id != null)
    .map(p => ({ ...toRow(p), sport, updated_at: runStart }));

  // A total crawl failure (every team unreachable) must never wipe the
  // existing cache via the stale-row cleanup below — fail loudly instead and
  // leave last run's data serving search.
  if (rows.length === 0) throw new Error("crawl returned zero players — refusing to touch existing cache");

  for (const batch of chunks(rows, CHUNK)) {
    const { error } = await supabase.from("player_index").upsert(batch, { onConflict: "sport,player_id" });
    if (error) throw new Error(`${sport} upsert failed: ${error.message}`);
  }

  // Remove players who left the index (retired, released, roster churn) —
  // any row for this sport not touched by this run is stale.
  await supabase.from("player_index").delete().eq("sport", sport).lt("updated_at", runStart);

  return rows.length;
}

export async function GET(request) {
  const authHeader = request.headers.get("authorization")?.replace("Bearer ", "");
  if (!timingSafeEqual(authHeader, process.env.CRON_SECRET)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabase();
  const results = {};

  try {
    results.mlb = await refreshSport(supabase, "mlb", buildMLBIndex, (p) => ({
      player_id: String(p.id),
      name: p.name,
      name_lower: p.name.toLowerCase(),
      team: p.team,
      position: p.position,
      injury_status: null,
    }));
  } catch (e) {
    results.mlb = { error: e.message };
  }

  try {
    results.nfl = await refreshSport(supabase, "nfl", buildNFLIndex, (p) => ({
      player_id: String(p.id),
      name: p.name,
      name_lower: p.name.toLowerCase(),
      team: p.team,
      position: p.position,
      injury_status: p.injuryStatus || null,
    }));
  } catch (e) {
    results.nfl = { error: e.message };
  }

  return Response.json(results);
}
