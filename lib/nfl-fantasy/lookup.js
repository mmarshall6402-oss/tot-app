// Resolves an ESPN-shaped player (from lib/nfl-roster.js's lookupNFLPlayer/
// findMentionedNFLPlayers) to its nfl_fantasy_rankings row, so
// app/api/nfl/fantasy/route.js can ground Start/Sit/Trade/Ask answers in the
// real VORP/projection data instead of Claude's own training knowledge. A
// miss here (rookie not yet ranked, name mismatch) returns null — callers
// fall back to the plain ESPN roster/injury line, same graceful-degrade
// posture as the rest of this feature.
import { createClient } from "@supabase/supabase-js";

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const COLUMNS = "player_id, name, position, team, projected_points, ceiling_points, floor_points, vorp, rank_overall, rank_position, tier, injury_status, games_projected";

// Exported for reuse by app/api/nfl/fantasy/route.js, which needs the same
// PPR/Half-PPR/Standard normalization when logging a live probability call
// (lib/nfl-fantasy/probability-log.js) so the log's scoring_format matches
// exactly what this lookup queried against.
export function normalizeFormat(scoringFormat) {
  const s = (scoringFormat || "ppr").toLowerCase();
  if (s.includes("half")) return "half_ppr";
  if (s.includes("standard")) return "standard";
  return "ppr";
}

function fmt(n) {
  return typeof n === "number" ? n.toFixed(1) : "?";
}

function formatRankingLine(row) {
  const vorpSign = row.vorp >= 0 ? "+" : "";
  return `${row.name} (${row.position}, ${row.team || "?"}) — proj ${fmt(row.projected_points)} pts, ` +
    `VORP ${vorpSign}${fmt(row.vorp)} (Tier ${row.tier}, ${row.position}${row.rank_position} overall #${row.rank_overall}) — ` +
    `ceiling ${fmt(row.ceiling_points)} / floor ${fmt(row.floor_points)} — injury: ${row.injury_status || "none listed"}`;
}

// Raw row lookup, shared by rankingsContextLine (chat context) and
// headToHeadProbability's callers (start/sit probability) — both need the
// same espn_id-then-name resolution, they just format the result differently.
export async function rankingsRow(espnPlayer, scoringFormat) {
  if (!espnPlayer) return null;
  const format = normalizeFormat(scoringFormat);
  try {
    const supabase = getSupabase();

    if (espnPlayer.id) {
      const { data } = await supabase.from("nfl_fantasy_rankings").select(COLUMNS)
        .eq("scoring_format", format).eq("espn_id", String(espnPlayer.id)).limit(1);
      if (data?.[0]) return data[0];
    }
    if (espnPlayer.name) {
      const { data } = await supabase.from("nfl_fantasy_rankings").select(COLUMNS)
        .eq("scoring_format", format).ilike("name", espnPlayer.name).limit(1);
      if (data?.[0]) return data[0];
    }
    return null;
  } catch (e) {
    console.warn("[nfl-fantasy] rankings lookup failed:", e.message);
    return null;
  }
}

export async function rankingsContextLine(espnPlayer, scoringFormat) {
  const row = await rankingsRow(espnPlayer, scoringFormat);
  return row ? formatRankingLine(row) : null;
}
