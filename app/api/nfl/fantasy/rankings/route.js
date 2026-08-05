// GET /api/nfl/fantasy/rankings?format=ppr&position=RB&limit=200
// Cron computes (see app/api/cron/nfl-fantasy-rankings), this route just
// reads — same cheap-select split as lib/nfl-roster.js's searchNFLPlayers.
// Not Pro-gated, matching the rest of the Fantasy tab (see NFLSection.js).
import { createClient } from "@supabase/supabase-js";
import { requireAuth } from "../../../../../lib/auth.js";

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const VALID_FORMATS = new Set(["ppr", "half_ppr", "standard"]);
const VALID_POSITIONS = new Set(["QB", "RB", "WR", "TE"]);

export async function GET(request) {
  const { error: authError } = await requireAuth(request);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const format = searchParams.get("format") || "ppr";
  const position = searchParams.get("position");
  const limit = Math.min(300, parseInt(searchParams.get("limit"), 10) || 200);

  if (!VALID_FORMATS.has(format)) {
    return Response.json({ error: "format must be ppr, half_ppr, or standard" }, { status: 400 });
  }
  if (position && !VALID_POSITIONS.has(position)) {
    return Response.json({ error: "position must be QB, RB, WR, or TE" }, { status: 400 });
  }

  const supabase = getSupabase();
  let query = supabase
    .from("nfl_fantasy_rankings")
    .select("player_id, name, position, team, projected_points, ceiling_points, floor_points, vorp, ceiling_vorp, rank_overall, rank_position, tier, injury_status, injury_risk, trending_add_count, personnel_note, pace_note, playcaller_note, manual_override_note, season, updated_at")
    .eq("scoring_format", format)
    .order("rank_overall", { ascending: true })
    .limit(limit);
  if (position) query = query.eq("position", position);

  const { data, error } = await query;
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ format, position: position || "ALL", rankings: data || [] });
}
