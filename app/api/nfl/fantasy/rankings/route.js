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

// Same rule used elsewhere in this codebase (app/api/cron/nfl-fantasy-rankings,
// app/api/nfl/fantasy/draft): NFL season "year" runs Sept-Feb. Rows from a
// prior season are never deleted (the cron only purges stale rows within
// its own targetSeason), so once a new season's rows are upserted in,
// leaving this unfiltered would return both seasons' rows for the same
// player, duplicated and interleaved in rank order.
function currentNflSeason(now = new Date()) {
  return now.getMonth() >= 2 ? now.getFullYear() : now.getFullYear() - 1;
}

export async function GET(request) {
  const { error: authError } = await requireAuth(request);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const format = searchParams.get("format") || "ppr";
  const position = searchParams.get("position");
  // Cap of 600 (up from 300) so the Draft Assistant's own pool fetch — which
  // needs every drafted player resolvable, not just the players worth
  // showing on the Cheat Sheet — comfortably covers deep/dynasty league
  // roster counts. A cap below the model's actual ranked-player count
  // silently drops a legitimately-drafted late pick out of My Roster,
  // roster-needs math, and Draft History (nothing in draftPoolById.get()
  // falls back for a miss) rather than erroring, so raising it is cheap
  // insurance against a UI that looks broken with no error surfaced.
  const limit = Math.min(600, parseInt(searchParams.get("limit"), 10) || 200);

  if (!VALID_FORMATS.has(format)) {
    return Response.json({ error: "format must be ppr, half_ppr, or standard" }, { status: 400 });
  }
  if (position && !VALID_POSITIONS.has(position)) {
    return Response.json({ error: "position must be QB, RB, WR, or TE" }, { status: 400 });
  }

  const supabase = getSupabase();
  let query = supabase
    .from("nfl_fantasy_rankings")
    .select("player_id, name, position, team, projected_points, ceiling_points, floor_points, vorp, ceiling_vorp, rank_overall, rank_position, tier, tier_position, injury_status, injury_risk, trending_add_count, personnel_note, pace_note, playcaller_note, adp, adp_rank, value_delta, projected_ppg, actual_ppg, games_played_actual, regression_delta, change_note, season, updated_at")
    .eq("scoring_format", format)
    .eq("season", currentNflSeason())
    .order("rank_overall", { ascending: true })
    .limit(limit);
  if (position) query = query.eq("position", position);

  const { data, error } = await query;
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ format, position: position || "ALL", rankings: data || [] });
}
