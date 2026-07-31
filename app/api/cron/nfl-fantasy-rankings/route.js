// app/api/cron/nfl-fantasy-rankings/route.js
//
// Weekly refresh of the nfl_fantasy_rankings table (sql/012_nfl_fantasy.sql)
// that /api/nfl/fantasy/rankings reads from. Prior-season stats don't
// change, so this does NOT re-fetch nflverse data (see
// scripts/nfl-fantasy/fetch-nflverse.js, run manually/off-season) — it only
// recomputes projections/VORP/tiers against the cached data/nflverse/*.json
// and refreshes current-season injury/team context from ESPN, same
// upsert-then-delete-stale pattern as /api/cron/player-index.
import { readFile } from "fs/promises";
import { join } from "path";
import { createClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "../../../../lib/auth.js";
import { buildPlayerIndex } from "../../../../lib/nfl-roster.js";
import { buildIdCrosswalk } from "../../../../lib/nfl-fantasy/id-map.js";
import { groupByPlayer, buildRankings, POSITIONS } from "../../../../lib/nfl-fantasy/rankings.js";
import { injuryAdjustedGames, classifyInjuryRisk } from "../../../../lib/nfl-fantasy/injury.js";
import { fetchSleeperPlayerIndex, buildEspnIdIndex, fetchTrendingAdds } from "../../../../lib/nfl-fantasy/sleeper.js";

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const FORMATS = ["ppr", "half_ppr", "standard"];
const DATA_DIR = join(process.cwd(), "data/nflverse");

// NFL season "year" runs Sept-Feb; before March it's still last season's
// playoffs/offseason, so rankings should target the season about to start.
function currentNflSeason(now = new Date()) {
  return now.getMonth() >= 2 ? now.getFullYear() : now.getFullYear() - 1;
}

async function loadCachedData() {
  const [playerStatsRaw, playersRaw] = await Promise.all([
    readFile(join(DATA_DIR, "player_stats.json"), "utf8"),
    readFile(join(DATA_DIR, "players.json"), "utf8").catch(() => "[]"),
  ]);
  return {
    playerStatsRows: JSON.parse(playerStatsRaw).map((r) => ({ ...r, season: Number(r.season), week: Number(r.week) })),
    playersRows: JSON.parse(playersRaw),
  };
}

// Joins each ranked player to live ESPN injury/durability context. Missing
// crosswalk entries (recent rookies) fall back to name matching against the
// same live index, rather than shipping with no injury signal at all.
async function attachInjuryContext(ranked, crosswalk, espnIndex, historicalMissedRateById, sleeperEspnIndex, trendingByEspnId) {
  return ranked.map((p) => {
    const espnId = crosswalk.espnIdFor(p.playerId) || crosswalk.espnIdForName(p.name);
    let espnPlayer = null;
    if (espnId) {
      for (const candidate of espnIndex.values()) {
        if (String(candidate.id) === String(espnId)) { espnPlayer = candidate; break; }
      }
    }
    if (!espnPlayer) espnPlayer = espnIndex.get(p.name.toLowerCase()) || null;

    const sleeperPlayer = espnId ? sleeperEspnIndex.get(espnId) : null;
    const historicalRate = historicalMissedRateById.get(p.playerId) || 0;
    return {
      ...p,
      espnId: espnId || null,
      injuryStatus: espnPlayer?.injuryStatus || null,
      injuryRisk: classifyInjuryRisk(historicalRate),
      trendingAddCount: (espnId && trendingByEspnId.get(espnId)) || 0,
      gamesProjectedAdjusted: injuryAdjustedGames(p.projection.gamesProjected, {
        currentStatus: espnPlayer?.injuryStatus,
        historicalGamesMissedRate: historicalRate,
        depthChartOrder: sleeperPlayer?.depthChartOrder,
      }),
    };
  });
}

function computeHistoricalMissedRate(playersById, targetSeason, lookbackSeasons = 2) {
  const rates = new Map();
  for (const [playerId, games] of playersById) {
    const relevant = games.filter((g) => g.season < targetSeason && g.season >= targetSeason - lookbackSeasons);
    const seasons = new Set(relevant.map((g) => g.season));
    if (!seasons.size) { rates.set(playerId, 0); continue; }
    const expectedGames = seasons.size * 17;
    rates.set(playerId, Math.max(0, 1 - relevant.length / expectedGames));
  }
  return rates;
}

async function refreshFormat(supabase, format, playersById, targetSeason, crosswalk, espnIndex, historicalMissedRateById, sleeperEspnIndex, trendingByEspnId) {
  const runStart = new Date().toISOString();
  const ranked = buildRankings(playersById, { targetSeason, format });
  if (!ranked.length) throw new Error(`${format}: ranking produced zero players — refusing to touch existing cache`);

  const withInjury = await attachInjuryContext(ranked, crosswalk, espnIndex, historicalMissedRateById, sleeperEspnIndex, trendingByEspnId);

  const rowsByPosition = {};
  for (const pos of POSITIONS) rowsByPosition[pos] = withInjury.filter((p) => p.position === pos);

  const rows = withInjury.map((p) => ({
    player_id: p.playerId,
    espn_id: p.espnId,
    name: p.name,
    position: p.position,
    team: p.team,
    scoring_format: format,
    season: targetSeason,
    projected_points: p.projection.mean,
    ceiling_points: p.projection.p80,
    floor_points: p.projection.p20,
    replacement_pts: p.replacementPoints,
    vorp: p.vorp,
    ceiling_vorp: p.ceilingVorp,
    rank_overall: p.rankOverall,
    rank_position: rowsByPosition[p.position].findIndex((x) => x.playerId === p.playerId) + 1,
    tier: p.tier,
    injury_status: p.injuryStatus,
    injury_risk: p.injuryRisk,
    trending_add_count: p.trendingAddCount,
    updated_at: runStart,
  }));

  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await supabase
      .from("nfl_fantasy_rankings")
      .upsert(rows.slice(i, i + CHUNK), { onConflict: "player_id,scoring_format,season" });
    if (error) throw new Error(`${format} upsert failed: ${error.message}`);
  }

  await supabase
    .from("nfl_fantasy_rankings")
    .delete()
    .eq("scoring_format", format)
    .eq("season", targetSeason)
    .lt("updated_at", runStart);

  return rows.length;
}

export async function GET(request) {
  const authHeader = request.headers.get("authorization")?.replace("Bearer ", "");
  if (!timingSafeEqual(authHeader, process.env.CRON_SECRET)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const targetSeason = currentNflSeason();
  const results = {};

  let playerStatsRows, playersRows;
  try {
    ({ playerStatsRows, playersRows } = await loadCachedData());
  } catch (e) {
    return Response.json({ error: `failed to load cached nflverse data — run 'npm run fantasy-fetch' first: ${e.message}` }, { status: 500 });
  }

  const playersById = groupByPlayer(playerStatsRows);
  const crosswalk = buildIdCrosswalk(playersRows);
  const historicalMissedRateById = computeHistoricalMissedRate(playersById, targetSeason);

  let espnIndex;
  try {
    espnIndex = await buildPlayerIndex();
  } catch {
    espnIndex = new Map(); // live injury context is best-effort — rankings still compute without it
  }

  const sleeperIndex = await fetchSleeperPlayerIndex(); // already degrades to empty Map on failure
  const sleeperEspnIndex = buildEspnIdIndex(sleeperIndex);
  const trendingAdds = await fetchTrendingAdds();
  const trendingByEspnId = new Map();
  for (const { sleeperId, count } of trendingAdds) {
    const espnId = sleeperIndex.get(sleeperId)?.espnId;
    if (espnId) trendingByEspnId.set(espnId, count);
  }

  const supabase = getSupabase();
  for (const format of FORMATS) {
    try {
      results[format] = await refreshFormat(supabase, format, playersById, targetSeason, crosswalk, espnIndex, historicalMissedRateById, sleeperEspnIndex, trendingByEspnId);
    } catch (e) {
      results[format] = { error: e.message };
    }
  }

  return Response.json({ targetSeason, ...results });
}
