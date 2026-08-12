// GET /api/nfl/fantasy/draft-teams/shared?token=...
// Public, unauthenticated read for a saved draft team's share link
// (app/draft-team/[token]/page.js). Deliberately outside requireAuth — the
// whole point of a share link is that whoever has the URL can view it
// without an account. share_token is an unguessable random value (see
// .../draft-teams/share/route.js), so this doesn't leak anything beyond
// what the owner explicitly chose to share, and only my_ids (the roster) is
// ever resolved to real player rows — never drafted_ids, which would expose
// everyone else's picks too.
import { createClient } from "@supabase/supabase-js";
import { buildLineup } from "../../../../../../lib/nfl-fantasy/draft-assistant.js";

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Same rule used throughout lib/nfl-fantasy and app/api/nfl: NFL season
// "year" runs Sept-Feb.
function currentNflSeason(now = new Date()) {
  return now.getMonth() >= 2 ? now.getFullYear() : now.getFullYear() - 1;
}

export async function GET(request) {
  const token = new URL(request.url).searchParams.get("token");
  if (!token) return Response.json({ error: "token is required" }, { status: 400 });

  const supabase = getSupabase();
  const { data: team, error: dbErr } = await supabase
    .from("nfl_fantasy_draft_teams")
    .select("name, scoring_format, my_ids, updated_at")
    .eq("share_token", token).single();
  if (dbErr || !team) return Response.json({ error: "This share link is invalid or has been revoked." }, { status: 404 });

  const myIds = Array.isArray(team.my_ids) ? team.my_ids : [];
  let players = [];
  if (myIds.length > 0) {
    const { data: rows } = await supabase
      .from("nfl_fantasy_rankings")
      .select("player_id, name, position, team, rank_overall, projected_points")
      .eq("scoring_format", team.scoring_format)
      .eq("season", currentNflSeason())
      .in("player_id", myIds);
    players = rows || [];
  }

  const { starters, bench } = buildLineup(players);
  return Response.json({
    name: team.name,
    scoringFormat: team.scoring_format,
    updatedAt: team.updated_at,
    starters,
    bench,
  });
}
