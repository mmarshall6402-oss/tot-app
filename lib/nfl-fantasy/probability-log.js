// Writes to fantasy_probability_log (sql/018) — shared between the
// historical backtest CLI (bulk insert, resolved rows) and the live
// Start/Sit endpoint (single insert, unresolved). Kept in one place so the
// two write paths can't drift into different column shapes.
import { createClient } from "@supabase/supabase-js";

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// predictions: runProbabilityBacktest()'s output rows — already resolved,
// since they're graded against real historical results.
export async function persistProbabilityBacktestRows(supabase, predictions, { format }) {
  const BATCH = 500;
  const rows = predictions.map((p) => ({
    source: "backtest",
    scoring_format: format,
    season: p.season,
    week: p.week,
    position: p.position,
    player_a_id: p.playerAId,
    player_a_name: p.playerAName,
    player_b_id: p.playerBId,
    player_b_name: p.playerBName,
    predicted_prob_a: p.predictedProbA,
    actual_points_a: p.actualPointsA,
    actual_points_b: p.actualPointsB,
    actual_winner: p.actualWinner,
    resolved: true,
  }));
  for (let i = 0; i < rows.length; i += BATCH) {
    const { error } = await supabase.from("fantasy_probability_log").insert(rows.slice(i, i + BATCH));
    if (error) throw new Error(`fantasy_probability_log insert failed at batch ${i}: ${error.message}`);
  }
  return rows.length;
}

// Logs one real Start/Sit call from app/api/nfl/fantasy/route.js. Awaited
// inline by the caller (not detached) — an un-awaited promise in a
// serverless function risks getting killed the moment the response is sent,
// so this trades a little latency for the insert actually landing. Never
// throws: a logging failure should never break the user-facing verdict.
export async function logLiveProbabilityCall({ rowA, rowB, probability, scoringFormat, season }) {
  try {
    const supabase = getSupabase();
    const { error } = await supabase.from("fantasy_probability_log").insert({
      source: "live",
      scoring_format: scoringFormat,
      season,
      week: null, // no current-week calculator yet — filled in once a resolution job exists
      position: rowA.position && rowA.position === rowB.position ? rowA.position : null,
      player_a_id: rowA.player_id || null,
      player_a_name: rowA.name,
      player_b_id: rowB.player_id || null,
      player_b_name: rowB.name,
      predicted_prob_a: probability.playerAProbability,
      resolved: false,
    });
    if (error) console.warn("[nfl-fantasy] probability log insert failed:", error.message);
  } catch (e) {
    console.warn("[nfl-fantasy] probability log insert failed:", e.message);
  }
}
