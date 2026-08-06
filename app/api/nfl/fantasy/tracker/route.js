// GET/POST /api/nfl/fantasy/tracker — the in-season dashboard's watchlist:
// add/remove tracked players, and read back each one's season-long schedule
// difficulty, this-week matchup difficulty, actual-vs-projected points, and
// any teammate-injury opportunity alerts. Not Pro-gated, matching the rest
// of the Fantasy tab (see app/api/nfl/fantasy/rankings/route.js).
import { createClient } from "@supabase/supabase-js";
import { requireAuth } from "../../../../../lib/auth.js";
import { normalizeName } from "../../../../../lib/nfl-fantasy/id-map.js";
import { DIFFICULTY_SCORE } from "../../../../../lib/nfl-fantasy/schedule-adjustment.js";
import { computeTeammateImpacts } from "../../../../../lib/nfl-fantasy/teammate-impact.js";

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const VALID_FORMATS = new Set(["ppr", "half_ppr", "standard"]);

// Mirrors currentNflSeason() in the two fantasy crons — kept local rather
// than shared, same reasoning as app/api/cron/player-index/route.js.
function currentNflSeason(now = new Date()) {
  return now.getMonth() >= 2 ? now.getFullYear() : now.getFullYear() - 1;
}

// Best-effort: resolves each tracked row's nflverse gsis_id from its espn_id
// via nfl_fantasy_rankings.espn_id (a rookie/practice-squad player who
// hasn't hit that table yet just stays unresolved — no projections/actuals
// for them yet, not a hard failure).
async function resolvePlayerIds(supabase, tracked, season) {
  const unresolved = tracked.filter((t) => !t.player_id).map((t) => t.espn_id);
  if (!unresolved.length) return;
  const { data } = await supabase
    .from("nfl_fantasy_rankings")
    .select("player_id, espn_id")
    .eq("season", season)
    .in("espn_id", unresolved);
  const byEspnId = new Map((data || []).map((r) => [r.espn_id, r.player_id]));
  const updates = [];
  for (const t of tracked) {
    const resolved = byEspnId.get(t.espn_id);
    if (resolved && !t.player_id) {
      t.player_id = resolved;
      updates.push(supabase.from("nfl_fantasy_tracked_players").update({ player_id: resolved }).eq("id", t.id));
    }
  }
  if (updates.length) await Promise.all(updates);
}

function seasonDifficultyFor(name, scheduleByName, fromWeek) {
  const rows = scheduleByName.get(normalizeName(name)) || [];
  const relevant = fromWeek ? rows.filter((r) => r.week >= fromWeek) : rows;
  if (!relevant.length) return null;
  const avg = relevant.reduce((sum, r) => sum + (DIFFICULTY_SCORE[r.difficulty] ?? 0), 0) / relevant.length;
  return Math.round(avg * 100) / 100;
}

function weekDifficultyFor(name, scheduleByName, week) {
  if (!week) return null;
  const rows = scheduleByName.get(normalizeName(name)) || [];
  const row = rows.find((r) => r.week === week);
  return row ? { difficulty: row.difficulty, opponent: row.opponent } : null;
}

export async function GET(request) {
  const { user, error: authError } = await requireAuth(request);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const format = searchParams.get("format") || "ppr";
  if (!VALID_FORMATS.has(format)) {
    return Response.json({ error: "format must be ppr, half_ppr, or standard" }, { status: 400 });
  }
  const season = parseInt(searchParams.get("season"), 10) || currentNflSeason();
  const week = parseInt(searchParams.get("week"), 10) || null;

  const supabase = getSupabase();

  const { data: tracked, error: trackedError } = await supabase
    .from("nfl_fantasy_tracked_players")
    .select("id, espn_id, player_id, name, position, team")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });
  if (trackedError) return Response.json({ error: trackedError.message }, { status: 500 });
  if (!tracked?.length) return Response.json({ season, week, format, players: [] });

  await resolvePlayerIds(supabase, tracked, season);

  const playerIds = tracked.map((t) => t.player_id).filter(Boolean);
  const espnIds = tracked.map((t) => t.espn_id);

  const [{ data: rankingRows }, { data: actualRows }, { data: scheduleRows }, { data: playerIndexRows }, { data: injuryLogRows }] = await Promise.all([
    playerIds.length
      ? supabase.from("nfl_fantasy_rankings").select("player_id, projected_points, ceiling_points, injury_status, injury_risk")
          .eq("season", season).eq("scoring_format", format).in("player_id", playerIds)
      : { data: [] },
    playerIds.length
      ? supabase.from("nfl_fantasy_weekly_actual").select("player_id, week, actual_points, opponent")
          .eq("season", season).eq("scoring_format", format).in("player_id", playerIds).order("week", { ascending: true })
      : { data: [] },
    supabase.from("nfl_fantasy_schedule_difficulty").select("player_name, week, difficulty, opponent").eq("season", season),
    supabase.from("player_index").select("player_id, name, team, position, injury_status").eq("sport", "nfl"),
    supabase.from("nfl_fantasy_injury_log").select("espn_id, name, team, position, old_status, new_status, changed_at")
      .eq("season", season).order("changed_at", { ascending: false }).limit(200),
  ]);

  const rankingByPlayerId = new Map((rankingRows || []).map((r) => [r.player_id, r]));
  const actualsByPlayerId = new Map();
  for (const r of actualRows || []) {
    const list = actualsByPlayerId.get(r.player_id) || [];
    list.push(r);
    actualsByPlayerId.set(r.player_id, list);
  }
  const scheduleByName = new Map();
  for (const r of scheduleRows || []) {
    const key = normalizeName(r.player_name);
    const list = scheduleByName.get(key) || [];
    list.push(r);
    scheduleByName.set(key, list);
  }

  const teammateAlerts = computeTeammateImpacts(injuryLogRows || [], playerIndexRows || [])
    .filter((a) => espnIds.includes(a.affectedEspnId));
  const alertsByEspnId = new Map();
  for (const a of teammateAlerts) {
    const list = alertsByEspnId.get(a.affectedEspnId) || [];
    list.push(a);
    alertsByEspnId.set(a.affectedEspnId, list);
  }

  const players = tracked.map((t) => {
    const ranking = t.player_id ? rankingByPlayerId.get(t.player_id) : null;
    const actuals = (t.player_id ? actualsByPlayerId.get(t.player_id) : null) || [];
    return {
      espnId: t.espn_id,
      playerId: t.player_id || null,
      name: t.name,
      position: t.position,
      team: t.team,
      projectedPoints: ranking?.projected_points ?? null,
      ceilingPoints: ranking?.ceiling_points ?? null,
      injuryStatus: ranking?.injury_status ?? null,
      injuryRisk: ranking?.injury_risk ?? null,
      seasonDifficulty: seasonDifficultyFor(t.name, scheduleByName, week),
      thisWeekDifficulty: weekDifficultyFor(t.name, scheduleByName, week),
      actuals: actuals.map((a) => ({ week: a.week, points: a.actual_points, opponent: a.opponent })),
      teammateAlerts: alertsByEspnId.get(t.espn_id) || [],
    };
  });

  return Response.json({ season, week, format, players });
}

export async function POST(request) {
  const { user, error: authError } = await requireAuth(request);
  if (authError) return authError;

  const body = await request.json().catch(() => ({}));
  const { action, espnId } = body;
  if (!espnId) return Response.json({ error: "espnId required" }, { status: 400 });

  const supabase = getSupabase();

  if (action === "remove") {
    const { error } = await supabase.from("nfl_fantasy_tracked_players").delete().eq("user_id", user.id).eq("espn_id", String(espnId));
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ removed: true });
  }

  if (action === "add") {
    const { name, position, team } = body;
    if (!name) return Response.json({ error: "name required" }, { status: 400 });
    const { error } = await supabase.from("nfl_fantasy_tracked_players")
      .upsert({ user_id: user.id, espn_id: String(espnId), name, position: position || null, team: team || null }, { onConflict: "user_id,espn_id" });
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ added: true });
  }

  return Response.json({ error: "action must be add or remove" }, { status: 400 });
}
