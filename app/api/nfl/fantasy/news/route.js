// GET /api/nfl/fantasy/news
// Two independent feeds, both best-effort: an injury report read straight off
// nfl_fantasy_rankings (same table/columns as .../fantasy/rankings, just
// filtered to players carrying a live injury_status), and general NFL
// headlines from ESPN's public news API (lib/nfl-fantasy/news.js). Not
// Pro-gated, matching the rest of the Fantasy tab (see NFLSection.js).
import { createClient } from "@supabase/supabase-js";
import { requireAuth } from "../../../../../lib/auth.js";
import { fetchNFLHeadlines } from "../../../../../lib/nfl-fantasy/news.js";

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function GET(request) {
  const { error: authError } = await requireAuth(request);
  if (authError) return authError;

  const supabase = getSupabase();

  const [rankingsResult, headlines] = await Promise.all([
    supabase
      .from("nfl_fantasy_rankings")
      .select("player_id, name, position, team, injury_status, injury_risk, rank_overall")
      .eq("scoring_format", "ppr")
      .not("injury_status", "is", null)
      .order("rank_overall", { ascending: true })
      .limit(100),
    fetchNFLHeadlines(20).catch(() => []),
  ]);

  if (rankingsResult.error) return Response.json({ error: rankingsResult.error.message }, { status: 500 });

  return Response.json({ injuryReport: rankingsResult.data || [], headlines });
}
