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
// onRowsBuilt (optional): called with the freshly-built rows right before
// the upsert, so a caller can diff them against whatever was there before
// this run overwrites it (see logInjuryTransitions below).
async function refreshSport(supabase, sport, buildIndex, toRow, onRowsBuilt) {
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

  if (onRowsBuilt) await onRowsBuilt(rows);

  for (const batch of chunks(rows, CHUNK)) {
    const { error } = await supabase.from("player_index").upsert(batch, { onConflict: "sport,player_id" });
    if (error) throw new Error(`${sport} upsert failed: ${error.message}`);
  }

  // Remove players who left the index (retired, released, roster churn) —
  // any row for this sport not touched by this run is stale.
  await supabase.from("player_index").delete().eq("sport", sport).lt("updated_at", runStart);

  return rows.length;
}

// NFL season "year" runs Sept-Feb; before March it's still last season's
// playoffs/offseason. Mirrors currentNflSeason() in
// app/api/cron/nfl-fantasy-rankings/route.js (kept local — pulling in that
// whole route just for this one helper isn't worth the coupling).
function currentNflSeason(now = new Date()) {
  return now.getMonth() >= 2 ? now.getFullYear() : now.getFullYear() - 1;
}

// Diffs the freshly-crawled NFL rows against whatever player_index already
// had for injury_status and logs every change to nfl_fantasy_injury_log —
// the source of truth for the tracker's news feed and teammate-impact
// alerts (lib/nfl-fantasy/teammate-impact.js). Best-effort: a logging
// failure shouldn't fail the whole player-index refresh.
async function logInjuryTransitions(supabase, newRows) {
  try {
    const { data: previous, error } = await supabase
      .from("player_index")
      .select("player_id, injury_status")
      .eq("sport", "nfl");
    if (error) throw error;

    const previousByEspnId = new Map((previous || []).map(r => [r.player_id, r.injury_status]));
    const season = currentNflSeason();
    const changes = [];
    for (const row of newRows) {
      const prevStatus = previousByEspnId.get(row.player_id) || null;
      const newStatus = row.injury_status || null;
      if (prevStatus === newStatus) continue;
      changes.push({
        espn_id: row.player_id,
        name: row.name,
        team: row.team,
        position: row.position,
        old_status: prevStatus,
        new_status: newStatus,
        season,
      });
    }
    if (!changes.length) return 0;

    const { error: insertError } = await supabase.from("nfl_fantasy_injury_log").insert(changes);
    if (insertError) throw insertError;
    return changes.length;
  } catch (e) {
    console.warn("[cron/player-index] injury transition logging failed:", e.message);
    return 0;
  }
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
    let injuryChanges = 0;
    results.nfl = await refreshSport(
      supabase, "nfl", buildNFLIndex,
      (p) => ({
        player_id: String(p.id),
        name: p.name,
        name_lower: p.name.toLowerCase(),
        team: p.team,
        position: p.position,
        injury_status: p.injuryStatus || null,
      }),
      async (rows) => { injuryChanges = await logInjuryTransitions(supabase, rows); }
    );
    results.nflInjuryChanges = injuryChanges;
  } catch (e) {
    results.nfl = { error: e.message };
  }

  return Response.json(results);
}
