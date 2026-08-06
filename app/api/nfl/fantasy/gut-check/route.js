// GET/POST /api/nfl/fantasy/gut-check — the tracker's manual weekly rating
// log (sql/017_nfl_fantasy_tracker.sql: nfl_fantasy_gut_check). Lets a user
// log their own gut-feel read on a player each week so it can be compared
// against the model's numbers and the player's actual result later. Not
// Pro-gated, matching the rest of the Fantasy tab.
import { createClient } from "@supabase/supabase-js";
import { requireAuth } from "../../../../../lib/auth.js";

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function currentNflSeason(now = new Date()) {
  return now.getMonth() >= 2 ? now.getFullYear() : now.getFullYear() - 1;
}

// GET ?season=&espnId= (optional) — with espnId, returns that player's full
// season rating history; without it, returns every rating the user logged
// this season across all tracked players (for the season log table).
export async function GET(request) {
  const { user, error: authError } = await requireAuth(request);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const season = parseInt(searchParams.get("season"), 10) || currentNflSeason();
  const espnId = searchParams.get("espnId");

  const supabase = getSupabase();
  let query = supabase
    .from("nfl_fantasy_gut_check")
    .select("espn_id, player_name, season, week, rating, note, updated_at")
    .eq("user_id", user.id)
    .eq("season", season)
    .order("week", { ascending: true });
  if (espnId) query = query.eq("espn_id", espnId);

  const { data, error } = await query;
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ season, entries: data || [] });
}

export async function POST(request) {
  const { user, error: authError } = await requireAuth(request);
  if (authError) return authError;

  const body = await request.json().catch(() => ({}));
  const { espnId, playerName, week, rating, note } = body;
  const season = parseInt(body.season, 10) || currentNflSeason();

  if (!espnId || !playerName) return Response.json({ error: "espnId and playerName required" }, { status: 400 });
  if (!Number.isInteger(week) || week < 1 || week > 18) return Response.json({ error: "week must be an integer 1-18" }, { status: 400 });
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return Response.json({ error: "rating must be an integer 1-5" }, { status: 400 });

  const supabase = getSupabase();
  const { error } = await supabase.from("nfl_fantasy_gut_check").upsert({
    user_id: user.id,
    espn_id: String(espnId),
    player_name: playerName,
    season,
    week,
    rating,
    note: note || null,
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id,espn_id,season,week" });

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ saved: true });
}
