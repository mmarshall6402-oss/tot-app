// app/api/cron/nfl-fantasy-resolve/route.js
//
// Runs daily (see vercel.json). Grades unresolved 'live' rows in
// fantasy_probability_log (sql/018) and fantasy_gut_calls (sql/019) —
// the model's own live-usage track record and each user's gut-vs-model
// record — once the NFL week they were logged for has finished.
//
// Only resolves rows for exactly the last-completed week (per SportsData.io,
// lib/nfl-fantasy/live-stats.js) — a row logged before that week finished
// stays pending rather than getting graded against the wrong week, and a
// row whose players don't turn up in that week's box scores (bye, DNP, a
// name-match miss) is left unresolved too, never guessed at as a 0. Running
// daily means a delayed game or a transient SportsData.io failure just gets
// retried the next day — every write here only touches resolved=false rows,
// so re-running is always safe.
import { createClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "../../../../lib/auth.js";
import { currentNflSeason } from "../../../../lib/nfl-fantasy/season.js";
import { fetchLastCompletedWeek, fetchWeeklyStatLines } from "../../../../lib/nfl-fantasy/live-stats.js";
import { weeklyFantasyPoints } from "../../../../lib/nfl-fantasy/scoring.js";

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function resolveTable(table, { season, week, lookupStatLine }) {
  const supabase = getSupabase();
  const { data: rows, error } = await supabase
    .from(table)
    .select("id, scoring_format, player_a_name, player_b_name")
    .eq("resolved", false)
    .eq("season", season)
    .eq("week", week);
  if (error) throw new Error(`${table} select failed: ${error.message}`);

  let resolvedCount = 0;
  let skipped = 0;
  for (const row of rows || []) {
    const statA = lookupStatLine(row.player_a_name);
    const statB = lookupStatLine(row.player_b_name);
    if (!statA || !statB) { skipped++; continue; }

    const pointsA = weeklyFantasyPoints(statA, row.scoring_format);
    const pointsB = weeklyFantasyPoints(statB, row.scoring_format);
    const actualWinner = pointsA === pointsB ? "push" : pointsA > pointsB ? "A" : "B";

    const { error: updateErr } = await supabase
      .from(table)
      .update({ actual_points_a: pointsA, actual_points_b: pointsB, actual_winner: actualWinner, resolved: true })
      .eq("id", row.id);
    if (updateErr) {
      console.warn(`[nfl-fantasy-resolve] ${table} update failed for id=${row.id}:`, updateErr.message);
      skipped++;
      continue;
    }
    resolvedCount++;
  }
  return { candidates: rows?.length || 0, resolved: resolvedCount, skipped };
}

export async function GET(request) {
  const authHeader = request.headers.get("authorization")?.replace("Bearer ", "");
  if (!timingSafeEqual(authHeader, process.env.CRON_SECRET)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const season = currentNflSeason();
  const week = await fetchLastCompletedWeek();
  if (!week) {
    return Response.json({ message: "Could not determine last completed NFL week (SportsData.io unavailable or SPORTSDATA_API_KEY not set) — nothing resolved this run." });
  }

  const lookupStatLine = await fetchWeeklyStatLines(season, week);
  if (!lookupStatLine) {
    return Response.json({ message: `Could not fetch week ${week} box scores — nothing resolved this run.`, season, week });
  }

  const [fantasyProbabilityLog, fantasyGutCalls] = await Promise.all([
    resolveTable("fantasy_probability_log", { season, week, lookupStatLine }),
    resolveTable("fantasy_gut_calls", { season, week, lookupStatLine }),
  ]);

  return Response.json({ season, week, fantasy_probability_log: fantasyProbabilityLog, fantasy_gut_calls: fantasyGutCalls });
}
