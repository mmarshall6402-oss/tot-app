// lib/backtest/persist.js
//
// Shared Supabase write path for backtest results, used by both the
// developer-run CLI (scripts/backtest/run.js) and the admin-triggered API
// route (app/api/admin/backtest/route.js) so the insert logic can't drift
// between the two entry points.

export async function persistRun(supabase, result) {
  const { data: run, error: runErr } = await supabase
    .from("backtest_runs")
    .insert({
      sport: "mlb",
      tier: result.tier,
      season_start: result.seasonStart,
      season_end: result.seasonEnd,
      game_count: result.gameCount,
      params: result.params,
      metrics: result.metrics,
    })
    .select()
    .single();

  if (runErr) throw new Error(`backtest_runs insert failed: ${runErr.message}`);

  // Batch insert to stay well under Supabase's request size limits.
  const BATCH = 500;
  for (let i = 0; i < result.rows.length; i += BATCH) {
    const batch = result.rows.slice(i, i + BATCH).map(r => ({ ...r, run_id: run.id }));
    const { error } = await supabase.from("backtest_games").insert(batch);
    if (error) throw new Error(`backtest_games insert failed at batch ${i}: ${error.message}`);
  }

  return run;
}
