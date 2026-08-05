// app/api/admin/player-overrides/route.js
// Private admin route — protected by admin email allowlist (same pattern as
// app/api/admin/weights and app/api/admin/tracker).
//
// CRUD over nfl_player_overrides (sql/017_nfl_player_overrides.sql), the
// hand-tuned per-player projection table lib/nfl-fantasy/player-override.js
// folds into the next nfl-fantasy-rankings cron run. This route never
// touches the rankings table itself — app/admin/players calls
// /api/admin/regen with type "nfl-fantasy-rankings" to rebuild after saving.
import { createClient } from "@supabase/supabase-js";
import { requireAuth } from "../../../../lib/auth.js";

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkAuth(request) {
  const { user } = await requireAuth(request);
  if (!user) return null;
  const admins = (process.env.NEXT_PUBLIC_ADMIN_EMAILS || process.env.NEXT_PUBLIC_ADMIN_EMAIL || "")
    .split(",").map(e => e.trim().toLowerCase()).filter(Boolean);
  return admins.includes(user.email?.toLowerCase()) ? user : null;
}

// Model's current computed number for a player, read straight from the live
// rankings table (PPR — same format the admin UI defaults to) so the
// sliders can pre-fill against "what the model says" rather than starting at
// zero. Best-effort: a player with no rankings row yet (e.g. a rookie before
// the first cron run) just gets nulls, sliders start blank.
async function fetchModelProjection(supabase, playerId) {
  const { data } = await supabase
    .from("nfl_fantasy_rankings")
    .select("projected_points, ceiling_points, floor_points, tier, rank_overall, rank_position")
    .eq("player_id", playerId)
    .eq("scoring_format", "ppr")
    .order("season", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data || null;
}

export async function GET(request) {
  const user = await checkAuth(request);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = getSupabase();
  const { searchParams } = new URL(request.url);
  const playerId = searchParams.get("playerId");

  try {
    if (playerId) {
      const [{ data: override }, model] = await Promise.all([
        supabase.from("nfl_player_overrides").select("*").eq("player_id", playerId).maybeSingle(),
        fetchModelProjection(supabase, playerId),
      ]);
      return Response.json({ override: override || null, model });
    }

    const { data: overrides, error } = await supabase
      .from("nfl_player_overrides")
      .select("*")
      .order("updated_at", { ascending: false });
    if (error) throw error;
    return Response.json({ overrides: overrides || [] });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(request) {
  const user = await checkAuth(request);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = getSupabase();
  const body = await request.json();

  try {
    if (body.action === "clear") {
      if (!body.playerId) return Response.json({ error: "Missing playerId" }, { status: 400 });
      const { error } = await supabase.from("nfl_player_overrides").delete().eq("player_id", body.playerId);
      if (error) throw error;
      return Response.json({ cleared: body.playerId });
    }

    if (body.action === "set") {
      const { playerId, name, position } = body;
      if (!playerId || !name) return Response.json({ error: "Missing playerId or name" }, { status: 400 });

      const toNumOrNull = (v) => (v === null || v === undefined || v === "" ? null : Number(v));
      const meanPoints = toNumOrNull(body.meanPoints);
      const floorPoints = toNumOrNull(body.floorPoints);
      const ceilingPoints = toNumOrNull(body.ceilingPoints);
      if ([meanPoints, floorPoints, ceilingPoints].some((v) => v !== null && !Number.isFinite(v))) {
        return Response.json({ error: "meanPoints/floorPoints/ceilingPoints must be numbers" }, { status: 400 });
      }

      const row = {
        player_id: playerId,
        name,
        position: position || null,
        mean_points: meanPoints,
        floor_points: floorPoints,
        ceiling_points: ceilingPoints,
        note: body.note || null,
        updated_at: new Date().toISOString(),
        updated_by: user.email,
      };
      const { data, error } = await supabase
        .from("nfl_player_overrides")
        .upsert(row, { onConflict: "player_id" })
        .select()
        .single();
      if (error) throw error;
      return Response.json({ override: data });
    }

    return Response.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
