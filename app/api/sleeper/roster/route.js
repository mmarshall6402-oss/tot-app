// GET /api/sleeper/roster?leagueId=... — the caller's roster in a selected
// league, enriched with our own projections/tiers (join on Sleeper's
// espn_id crosswalk) so "My Team" reads like the cheat sheet, not a bare
// list of names.
import { createClient } from "@supabase/supabase-js";
import { requireAuth } from "../../../../lib/auth.js";
import { fetchLeagueRosters, fetchLeagueUsers, fetchSleeperPlayerIndex } from "../../../../lib/nfl-fantasy/sleeper.js";

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function buildPlayerRow(sleeperId, playerIndex, rankingsByEspnId, slot) {
  const p = playerIndex.get(sleeperId);
  const ranking = p?.espnId ? rankingsByEspnId.get(p.espnId) : null;
  return {
    sleeperId,
    espnId: p?.espnId || null,
    slot,
    name: p?.name || "Unknown player",
    position: p?.position || null,
    team: p?.team || null,
    injuryStatus: p?.injuryStatus || null,
    projectedPoints: ranking?.projected_points ?? null,
    vorp: ranking?.vorp ?? null,
    rankOverall: ranking?.rank_overall ?? null,
    rankPosition: ranking?.rank_position ?? null,
    tier: ranking?.tier ?? null,
  };
}

export async function GET(request) {
  const { user, error: authError } = await requireAuth(request);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const leagueId = searchParams.get("leagueId");
  if (!leagueId) return Response.json({ error: "leagueId is required" }, { status: 400 });

  const supabase = getSupabase();
  const { data: selection } = await supabase
    .from("sleeper_league_selections")
    .select("league_id, league_name, season, roster_id, scoring_format")
    .eq("user_id", user.id)
    .eq("league_id", leagueId)
    .maybeSingle();
  if (!selection) return Response.json({ error: "That league isn't synced yet — select it under My Team first" }, { status: 400 });

  let rosters, leagueUsers, playerIndex;
  try {
    [rosters, leagueUsers, playerIndex] = await Promise.all([
      fetchLeagueRosters(leagueId),
      fetchLeagueUsers(leagueId),
      fetchSleeperPlayerIndex(),
    ]);
  } catch (e) {
    return Response.json({ error: `Sleeper lookup failed: ${e.message}` }, { status: 502 });
  }

  const myRoster = rosters.find((r) => r.rosterId === selection.roster_id);
  if (!myRoster) return Response.json({ error: "Roster not found — league may have reset" }, { status: 404 });

  const espnIds = [];
  for (const sid of myRoster.players) {
    const espnId = playerIndex.get(sid)?.espnId;
    if (espnId) espnIds.push(espnId);
  }

  const rankingsByEspnId = new Map();
  if (espnIds.length) {
    const { data: rankings } = await supabase
      .from("nfl_fantasy_rankings")
      .select("espn_id, projected_points, vorp, rank_overall, rank_position, tier")
      .eq("scoring_format", selection.scoring_format || "ppr")
      .eq("season", Number(selection.season))
      .in("espn_id", espnIds);
    for (const r of rankings || []) rankingsByEspnId.set(r.espn_id, r);
  }

  const starterSet = new Set(myRoster.starters.filter(Boolean));
  const reserveSet = new Set(myRoster.reserve);
  const bench = myRoster.players.filter((pid) => !starterSet.has(pid) && !reserveSet.has(pid));

  const owner = leagueUsers.find((u) => u.sleeperUserId === myRoster.ownerId);

  return Response.json({
    leagueId,
    leagueName: selection.league_name,
    teamName: owner?.teamName || owner?.displayName || null,
    record: { wins: myRoster.wins, losses: myRoster.losses, ties: myRoster.ties, fpts: myRoster.fpts },
    starters: myRoster.starters.filter(Boolean).map((pid) => buildPlayerRow(pid, playerIndex, rankingsByEspnId, "starter")),
    bench: bench.map((pid) => buildPlayerRow(pid, playerIndex, rankingsByEspnId, "bench")),
    reserve: myRoster.reserve.map((pid) => buildPlayerRow(pid, playerIndex, rankingsByEspnId, "ir")),
  });
}
