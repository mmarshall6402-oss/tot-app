// Joins a Sleeper roster's player_id list to our own nfl_fantasy_rankings —
// the same espn_id crosswalk the live cron uses (lib/nfl-fantasy/sleeper.js's
// player index) — so a connected roster shows real projections/VORP/tier
// instead of just names, and Start/Sit can be driven from someone's actual
// roster instead of typed-in names.
import { createClient } from "@supabase/supabase-js";
import { fetchSleeperPlayerIndex } from "./sleeper.js";

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const RANKING_COLUMNS = "espn_id, name, position, team, projected_points, ceiling_points, floor_points, vorp, rank_overall, rank_position, tier, injury_status, games_projected";

// sleeperPlayerIds: roster.players from lib/nfl-fantasy/sleeper.js's
// fetchLeagueRosters. A ranking miss (rookie, IDP/kicker/DST our engine
// doesn't rank) still returns the player — ranked: false, all projection
// fields null — rather than silently dropping a roster spot.
export async function buildRosterWithRankings(sleeperPlayerIds, scoringFormat = "ppr") {
  const sleeperIndex = await fetchSleeperPlayerIndex();
  const entries = (sleeperPlayerIds || [])
    .map((id) => sleeperIndex.get(id) || { sleeperId: id, name: null, position: null, team: null, espnId: null, injuryStatus: null })
    .filter(Boolean);

  const espnIds = [...new Set(entries.map((e) => e.espnId).filter(Boolean))];
  const rankingsByEspnId = new Map();
  if (espnIds.length) {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("nfl_fantasy_rankings")
      .select(RANKING_COLUMNS)
      .eq("scoring_format", scoringFormat)
      .in("espn_id", espnIds);
    if (error) console.warn("[nfl-fantasy] roster rankings join failed:", error.message);
    for (const row of data || []) rankingsByEspnId.set(row.espn_id, row);
  }

  const players = entries.map((e) => {
    const ranking = e.espnId ? rankingsByEspnId.get(e.espnId) : null;
    return {
      sleeperId: e.sleeperId,
      name: ranking?.name || e.name || "Unknown",
      position: ranking?.position || e.position,
      team: ranking?.team || e.team,
      injuryStatus: e.injuryStatus ?? ranking?.injury_status ?? null,
      projectedPoints: ranking?.projected_points ?? null,
      ceilingPoints: ranking?.ceiling_points ?? null,
      floorPoints: ranking?.floor_points ?? null,
      gamesProjected: ranking?.games_projected ?? null,
      vorp: ranking?.vorp ?? null,
      rankOverall: ranking?.rank_overall ?? null,
      rankPosition: ranking?.rank_position ?? null,
      tier: ranking?.tier ?? null,
      ranked: !!ranking,
    };
  });

  players.sort((a, b) => (a.rankOverall ?? Infinity) - (b.rankOverall ?? Infinity));
  return players;
}
