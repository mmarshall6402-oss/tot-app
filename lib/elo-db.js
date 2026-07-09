// ELO read/write backed by a Supabase *_elo table (team_elo for MLB, nfl_team_elo for NFL).
// Falls back to a seed JSON file on first boot or when the table is empty.

import { readFileSync } from "fs";
import { join } from "path";

const DEFAULT_ELO = 1500;

function expected(eloA, eloB) {
  return 1 / (1 + Math.pow(10, (eloB - eloA) / 400));
}

// Load ratings from Supabase; seed from JSON file if table is empty.
// table: Supabase table name. seedFile: path relative to cwd, or null to skip seeding
// (e.g. NFL has no historical backfill yet, so missing teams just default to DEFAULT_ELO).
export async function getEloRatings(supabase, table = "team_elo", seedFile = "data/elo_ratings.json") {
  const { data, error } = await supabase
    .from(table)
    .select("team_name, elo");

  if (data?.length) {
    return Object.fromEntries(data.map(r => [r.team_name, r.elo]));
  }

  // A transient read error is NOT the same as "table is genuinely empty" —
  // re-seeding here would silently overwrite months of live ratings with the
  // static seed file. Only fall through to seeding when the read actually
  // succeeded and came back empty.
  if (error) {
    console.warn(`[elo] ${table} read failed, skipping (not re-seeding):`, error.message);
    return {};
  }

  if (!seedFile) return {};

  // Seed from static file on first run
  try {
    const seed = JSON.parse(readFileSync(join(process.cwd(), seedFile), "utf8"));
    const rows = Object.entries(seed).map(([team_name, elo]) => ({ team_name, elo }));
    await supabase.from(table).upsert(rows, { onConflict: "team_name" });
    return seed;
  } catch {
    return {};
  }
}

// Update ELO for both teams after a final game result and persist to Supabase.
// k: rating volatility factor. homeAdvantage: flat rating bonus applied to the home team.
export async function updateEloAfterGame(supabase, homeTeam, awayTeam, homeWon, currentRatings, table = "team_elo", k = 20, homeAdvantage = 35) {
  const ratings = { ...currentRatings };
  const homeElo = ratings[homeTeam] ?? DEFAULT_ELO;
  const awayElo = ratings[awayTeam] ?? DEFAULT_ELO;

  const expHome = expected(homeElo + homeAdvantage, awayElo);
  const actual  = homeWon ? 1 : 0;

  ratings[homeTeam] = homeElo + k * (actual - expHome);
  ratings[awayTeam] = awayElo + k * ((1 - actual) - (1 - expHome));

  await supabase.from(table).upsert([
    { team_name: homeTeam, elo: ratings[homeTeam], updated_at: new Date().toISOString() },
    { team_name: awayTeam, elo: ratings[awayTeam], updated_at: new Date().toISOString() },
  ], { onConflict: "team_name" });

  return ratings;
}
