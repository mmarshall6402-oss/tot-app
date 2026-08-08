// GET /api/sleeper/draft?leagueId=... — picks made so far in a selected
// league's most recent draft, enriched with our rankings so each pick shows
// "picked at #42, our rank #18" (a reach/value read), without yet being the
// full live polling draft-room UI — this is the sync layer that feeds it.
import { createClient } from "@supabase/supabase-js";
import { requireAuth } from "../../../../lib/auth.js";
import { fetchLeagueDrafts, fetchDraftPicks, fetchLeagueUsers, fetchSleeperPlayerIndex } from "../../../../lib/nfl-fantasy/sleeper.js";

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function GET(request) {
  const { user, error: authError } = await requireAuth(request);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const leagueId = searchParams.get("leagueId");
  if (!leagueId) return Response.json({ error: "leagueId is required" }, { status: 400 });

  const supabase = getSupabase();
  const { data: selection } = await supabase
    .from("sleeper_league_selections")
    .select("league_id, season, roster_id, scoring_format")
    .eq("user_id", user.id)
    .eq("league_id", leagueId)
    .maybeSingle();
  if (!selection) return Response.json({ error: "That league isn't synced yet — select it under My Team first" }, { status: 400 });

  let drafts;
  try {
    drafts = await fetchLeagueDrafts(leagueId);
  } catch (e) {
    return Response.json({ error: `Sleeper lookup failed: ${e.message}` }, { status: 502 });
  }
  const draft = drafts[0];
  if (!draft) return Response.json({ draft: null, picks: [] });

  let picks, leagueUsers, playerIndex;
  try {
    [picks, leagueUsers, playerIndex] = await Promise.all([
      fetchDraftPicks(draft.draftId),
      fetchLeagueUsers(leagueId),
      fetchSleeperPlayerIndex(),
    ]);
  } catch (e) {
    return Response.json({ error: `Sleeper lookup failed: ${e.message}` }, { status: 502 });
  }

  const espnIds = [];
  for (const pk of picks) {
    const espnId = playerIndex.get(pk.sleeperPlayerId)?.espnId;
    if (espnId) espnIds.push(espnId);
  }

  const rankingsByEspnId = new Map();
  if (espnIds.length) {
    const { data: rankings } = await supabase
      .from("nfl_fantasy_rankings")
      .select("espn_id, rank_overall, rank_position, tier")
      .eq("scoring_format", selection.scoring_format || "ppr")
      .eq("season", Number(selection.season))
      .in("espn_id", espnIds);
    for (const r of rankings || []) rankingsByEspnId.set(r.espn_id, r);
  }

  const teamNameByRoster = new Map();
  for (const u of leagueUsers) teamNameByRoster.set(u.sleeperUserId, u.teamName || u.displayName);

  const enrichedPicks = picks.map((pk) => {
    const p = playerIndex.get(pk.sleeperPlayerId);
    const ranking = p?.espnId ? rankingsByEspnId.get(p.espnId) : null;
    return {
      pickNo: pk.pickNo,
      round: pk.round,
      rosterId: pk.rosterId,
      pickedBy: teamNameByRoster.get(pk.pickedBy) || null,
      isMine: pk.rosterId === selection.roster_id,
      espnId: p?.espnId || null,
      name: p?.name || "Unknown player",
      position: p?.position || null,
      team: p?.team || null,
      ourRankOverall: ranking?.rank_overall ?? null,
      ourRankPosition: ranking?.rank_position ?? null,
      tier: ranking?.tier ?? null,
      // positive = fell past our rank (value/steal), negative = reach
      valueDelta: ranking?.rank_overall != null ? pk.pickNo - ranking.rank_overall : null,
    };
  });

  return Response.json({
    draft: { draftId: draft.draftId, status: draft.status, type: draft.type, rounds: draft.rounds },
    myRosterId: selection.roster_id,
    picks: enrichedPicks,
  });
}
