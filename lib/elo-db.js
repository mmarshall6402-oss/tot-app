// ELO read/write backed by Supabase team_elo table.
// Falls back to data/elo_ratings.json on first boot or when table is empty.

import { readFileSync } from "fs";
import { join } from "path";

const DEFAULT_ELO = 1500;
const K = 20;
const HOME_ADVANTAGE = 35;

function expected(eloA, eloB) {
  return 1 / (1 + Math.pow(10, (eloB - eloA) / 400));
}

// Load ratings from Supabase; seed from JSON file if table is empty.
export async function getEloRatings(supabase) {
  const { data, error } = await supabase
    .from("team_elo")
    .select("team_name, elo");

  if (!error && data?.length) {
    return Object.fromEntries(data.map(r => [r.team_name, r.elo]));
  }

  // Seed from static file on first run
  try {
    const seed = JSON.parse(readFileSync(join(process.cwd(), "data/elo_ratings.json"), "utf8"));
    const rows = Object.entries(seed).map(([team_name, elo]) => ({ team_name, elo }));
    await supabase.from("team_elo").upsert(rows, { onConflict: "team_name" });
    return seed;
  } catch {
    return {};
  }
}

// Update ELO for both teams after a final game result and persist to Supabase.
export async function updateEloAfterGame(supabase, homeTeam, awayTeam, homeWon, currentRatings) {
  const ratings = { ...currentRatings };
  const homeElo = ratings[homeTeam] ?? DEFAULT_ELO;
  const awayElo = ratings[awayTeam] ?? DEFAULT_ELO;

  const expHome = expected(homeElo + HOME_ADVANTAGE, awayElo);
  const actual  = homeWon ? 1 : 0;

  ratings[homeTeam] = homeElo + K * (actual - expHome);
  ratings[awayTeam] = awayElo + K * ((1 - actual) - (1 - expHome));

  await supabase.from("team_elo").upsert([
    { team_name: homeTeam, elo: ratings[homeTeam], updated_at: new Date().toISOString() },
    { team_name: awayTeam, elo: ratings[awayTeam], updated_at: new Date().toISOString() },
  ], { onConflict: "team_name" });

  return ratings;
}
