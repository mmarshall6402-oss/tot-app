// Sleeper league connect + roster ingest. Sleeper's API is free, read-only,
// and needs no token (lib/nfl-fantasy/sleeper.js) — connecting is just:
// username -> pick a league -> we remember which roster is theirs
// (sql/017_sleeper_connections.sql). The roster itself is never cached: it's
// re-fetched from Sleeper and re-joined to our rankings on every read
// (lib/nfl-fantasy/roster.js), so waiver/trade moves show up immediately.
import { createClient } from "@supabase/supabase-js";
import { requireAuth } from "../../../../../lib/auth.js";
import { currentNflSeason } from "../../../../../lib/nfl-fantasy/season.js";
import { buildRosterWithRankings } from "../../../../../lib/nfl-fantasy/roster.js";
import {
  fetchSleeperUserByUsername,
  fetchUserLeagues,
  fetchLeague,
  fetchLeagueRosters,
  fetchLeagueUsers,
} from "../../../../../lib/nfl-fantasy/sleeper.js";

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const VALID_FORMATS = new Set(["ppr", "half_ppr", "standard"]);

function normalizeFormat(format) {
  return VALID_FORMATS.has(format) ? format : "ppr";
}

// Fetches league rosters+users and returns the specific roster/team-name
// owned by sleeperUserId, plus that roster's players joined to rankings.
// Returns null if the league lookup fails or the user has no roster in it
// (shouldn't happen for a league fetchUserLeagues just returned, but a
// league can be deleted between the two calls).
async function loadOwnedRoster(leagueId, sleeperUserId, format) {
  const [rosters, users] = await Promise.all([fetchLeagueRosters(leagueId), fetchLeagueUsers(leagueId)]);
  const roster = rosters.find((r) => r.ownerId === sleeperUserId);
  if (!roster) return null;
  const teamName = users.find((u) => u.sleeperUserId === sleeperUserId)?.teamName || null;
  const players = await buildRosterWithRankings(roster.players, format);
  return { rosterId: roster.rosterId, teamName, players };
}

export async function GET(request) {
  const { user, error: authError } = await requireAuth(request);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const format = normalizeFormat(searchParams.get("format"));

  const supabase = getSupabase();
  const { data: connection, error } = await supabase
    .from("sleeper_connections")
    .select("sleeper_user_id, sleeper_username, league_id, league_name, season, team_name")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!connection) return Response.json({ connected: false });

  const owned = await loadOwnedRoster(connection.league_id, connection.sleeper_user_id, format);
  if (!owned) {
    return Response.json({
      connected: true,
      league: { leagueId: connection.league_id, name: connection.league_name, season: connection.season },
      teamName: connection.team_name,
      error: "Could not load your roster from Sleeper — the league may have been deleted or reset.",
      players: [],
    });
  }

  return Response.json({
    connected: true,
    league: { leagueId: connection.league_id, name: connection.league_name, season: connection.season },
    teamName: owned.teamName || connection.team_name,
    players: owned.players,
  });
}

export async function POST(request) {
  const { user, error: authError } = await requireAuth(request);
  if (authError) return authError;

  let body;
  try { body = await request.json(); } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { mode, username, leagueId, leagueName, season } = body;
  const format = normalizeFormat(body.format);

  if (mode === "lookup") {
    if (!username?.trim()) return Response.json({ error: "username required" }, { status: 400 });
    const sleeperUser = await fetchSleeperUserByUsername(username.trim());
    if (!sleeperUser) return Response.json({ error: `No Sleeper user found for "${username}"` }, { status: 404 });

    const targetSeason = currentNflSeason();
    let leagues = await fetchUserLeagues(sleeperUser.sleeperUserId, String(targetSeason));
    if (!leagues.length) leagues = await fetchUserLeagues(sleeperUser.sleeperUserId, String(targetSeason - 1));
    if (!leagues.length) {
      return Response.json({ error: `No NFL leagues found for "${username}"` }, { status: 404 });
    }

    return Response.json({ sleeperUserId: sleeperUser.sleeperUserId, username: sleeperUser.username, leagues });
  }

  if (mode === "connect") {
    if (!body.sleeperUserId || !leagueId) {
      return Response.json({ error: "sleeperUserId and leagueId required" }, { status: 400 });
    }
    const league = await fetchLeague(leagueId);
    if (!league) return Response.json({ error: "League not found" }, { status: 404 });

    const owned = await loadOwnedRoster(leagueId, body.sleeperUserId, format);
    if (!owned) return Response.json({ error: "Could not find your roster in that league" }, { status: 404 });

    const supabase = getSupabase();
    const { error } = await supabase.from("sleeper_connections").upsert({
      user_id: user.id,
      sleeper_user_id: body.sleeperUserId,
      sleeper_username: body.username || null,
      league_id: leagueId,
      league_name: leagueName || league.name,
      season: season || String(league.season),
      roster_id: owned.rosterId,
      team_name: owned.teamName,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    if (error) return Response.json({ error: error.message }, { status: 500 });

    return Response.json({
      connected: true,
      league: { leagueId, name: leagueName || league.name, season: season || String(league.season) },
      teamName: owned.teamName,
      players: owned.players,
    });
  }

  return Response.json({ error: "mode must be lookup or connect" }, { status: 400 });
}

export async function DELETE(request) {
  const { user, error: authError } = await requireAuth(request);
  if (authError) return authError;

  const supabase = getSupabase();
  const { error } = await supabase.from("sleeper_connections").delete().eq("user_id", user.id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ connected: false });
}
