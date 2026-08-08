// GET  /api/sleeper/leagues?season=2026   — list the linked Sleeper user's
//      leagues for that season, flagging which one (if any) is selected.
// POST /api/sleeper/leagues                — select a league to sync as
//      "My Team"; body: { leagueId, season }.
import { createClient } from "@supabase/supabase-js";
import { requireAuth } from "../../../../lib/auth.js";
import { fetchUserLeagues, fetchLeagueRosters, fetchLeague, deriveScoringFormat } from "../../../../lib/nfl-fantasy/sleeper.js";

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function getLink(supabase, userId) {
  const { data } = await supabase
    .from("sleeper_links")
    .select("sleeper_user_id")
    .eq("user_id", userId)
    .maybeSingle();
  return data?.sleeper_user_id || null;
}

export async function GET(request) {
  const { user, error: authError } = await requireAuth(request);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const season = searchParams.get("season") || String(new Date().getFullYear());

  const supabase = getSupabase();
  const sleeperUserId = await getLink(supabase, user.id);
  if (!sleeperUserId) return Response.json({ error: "No Sleeper account linked" }, { status: 400 });

  let leagues;
  try {
    leagues = await fetchUserLeagues(sleeperUserId, season);
  } catch (e) {
    return Response.json({ error: `Sleeper lookup failed: ${e.message}` }, { status: 502 });
  }

  const { data: selections } = await supabase
    .from("sleeper_league_selections")
    .select("league_id")
    .eq("user_id", user.id);
  const selectedIds = new Set((selections || []).map((s) => s.league_id));

  return Response.json({
    season,
    leagues: leagues.map((l) => ({ ...l, selected: selectedIds.has(l.leagueId) })),
  });
}

export async function POST(request) {
  const { user, error: authError } = await requireAuth(request);
  if (authError) return authError;

  let body;
  try { body = await request.json(); } catch { body = {}; }
  const leagueId = (body?.leagueId || "").trim();
  const season = (body?.season || "").trim();
  if (!leagueId || !season) return Response.json({ error: "leagueId and season are required" }, { status: 400 });

  const supabase = getSupabase();
  const sleeperUserId = await getLink(supabase, user.id);
  if (!sleeperUserId) return Response.json({ error: "No Sleeper account linked" }, { status: 400 });

  let league, rosters;
  try {
    [league, rosters] = await Promise.all([fetchLeague(leagueId), fetchLeagueRosters(leagueId)]);
  } catch (e) {
    return Response.json({ error: `Sleeper lookup failed: ${e.message}` }, { status: 502 });
  }
  if (!league) return Response.json({ error: "League not found" }, { status: 404 });

  const myRoster = rosters.find((r) => r.ownerId === sleeperUserId);
  if (!myRoster) return Response.json({ error: "You don't have a roster in that league" }, { status: 400 });

  const { data, error } = await supabase
    .from("sleeper_league_selections")
    .upsert({
      user_id: user.id,
      league_id: leagueId,
      season,
      league_name: league.name,
      roster_id: myRoster.rosterId,
      scoring_format: deriveScoringFormat(league.scoringSettings),
      selected_at: new Date().toISOString(),
    }, { onConflict: "user_id,league_id" })
    .select()
    .single();
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ selection: data });
}

export async function DELETE(request) {
  const { user, error: authError } = await requireAuth(request);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const leagueId = searchParams.get("leagueId");
  if (!leagueId) return Response.json({ error: "leagueId is required" }, { status: 400 });

  const supabase = getSupabase();
  const { error } = await supabase
    .from("sleeper_league_selections")
    .delete()
    .eq("user_id", user.id)
    .eq("league_id", leagueId);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ ok: true });
}
