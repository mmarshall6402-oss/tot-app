// app/api/cron/nfl-fantasy-adp/route.js
//
// Daily refresh of nfl_fantasy_adp (sql/019_nfl_fantasy_adp.sql) from
// Fantasy Football Calculator's free PPR ADP API — mock-draft ADP, not
// real-league consensus. Matches FFC players to that season's
// nfl_fantasy_rankings (sql/012_nfl_fantasy.sql) by normalized name +
// position (lib/nfl-fantasy/id-map.js's normalizeName) so the Cheat Sheet
// can show "our rank vs market ADP." Unmatched rows (DEF/K, index gaps)
// are still stored with player_id null rather than dropped. Same
// upsert-then-delete-stale pattern as /api/cron/nfl-fantasy-rankings.
import { createClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "../../../../lib/auth.js";
import { fetchFfcAdp, rankByPosition, matchAdpToPlayerId } from "../../../../lib/nfl-fantasy/adp.js";

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const TEAMS = 12;
const SCORING_FORMAT = "ppr";

// NFL season "year" runs Sept-Feb; before March it's still last season's
// playoffs/offseason, so ADP should target the season about to start.
// Mirrors app/api/cron/nfl-fantasy-rankings/route.js's currentNflSeason.
function currentNflSeason(now = new Date()) {
  return now.getMonth() >= 2 ? now.getFullYear() : now.getFullYear() - 1;
}

export async function GET(request) {
  const authHeader = request.headers.get("authorization")?.replace("Bearer ", "");
  if (!timingSafeEqual(authHeader, process.env.CRON_SECRET)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const targetSeason = currentNflSeason();
  const supabase = getSupabase();

  let adpRows;
  try {
    adpRows = await fetchFfcAdp({ teams: TEAMS, year: targetSeason });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 502 });
  }
  rankByPosition(adpRows);

  const { data: rankingRows, error: rankingError } = await supabase
    .from("nfl_fantasy_rankings")
    .select("player_id, name, position")
    .eq("scoring_format", SCORING_FORMAT)
    .eq("season", targetSeason);
  if (rankingError) return Response.json({ error: rankingError.message }, { status: 500 });

  const matched = matchAdpToPlayerId(adpRows, rankingRows || []);

  const runStart = new Date().toISOString();
  const rows = matched.map((p) => ({
    ffc_player_id: p.ffcPlayerId,
    player_id: p.playerId,
    name: p.name,
    position: p.position,
    team: p.team,
    scoring_format: SCORING_FORMAT,
    season: targetSeason,
    teams: TEAMS,
    adp: p.adp,
    adp_position_rank: p.adpPositionRank,
    adp_high: p.adpHigh,
    adp_low: p.adpLow,
    times_drafted: p.timesDrafted,
    updated_at: runStart,
  }));

  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await supabase
      .from("nfl_fantasy_adp")
      .upsert(rows.slice(i, i + CHUNK), { onConflict: "season,scoring_format,teams,ffc_player_id" });
    if (error) return Response.json({ error: `upsert failed: ${error.message}` }, { status: 500 });
  }

  await supabase
    .from("nfl_fantasy_adp")
    .delete()
    .eq("season", targetSeason)
    .eq("scoring_format", SCORING_FORMAT)
    .eq("teams", TEAMS)
    .lt("updated_at", runStart);

  const matchedCount = rows.filter((r) => r.player_id).length;
  return Response.json({
    targetSeason,
    total: rows.length,
    matched: matchedCount,
    unmatched: rows.length - matchedCount,
  });
}
