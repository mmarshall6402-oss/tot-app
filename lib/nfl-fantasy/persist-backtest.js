// Shared Supabase write path for the fantasy backtest, used by both the CLI
// (scripts/nfl-fantasy/backtest.js) and the admin API route, mirroring
// lib/backtest/persist.js so the insert logic can't drift between the two.

export async function persistFantasyBacktestRun(supabase, result) {
  const { data: run, error: runErr } = await supabase
    .from("nfl_fantasy_backtest_runs")
    .insert({
      target_season: result.targetSeason,
      scoring_format: result.format,
      params: result.params || null,
      metrics: result.metrics,
      notes: result.notes || null,
    })
    .select()
    .single();
  if (runErr) throw new Error(`nfl_fantasy_backtest_runs insert failed: ${runErr.message}`);

  const BATCH = 500;
  const rows = result.rows.map((r) => ({
    run_id: run.id,
    player_id: r.playerId,
    name: r.name,
    position: r.position,
    predicted_rank_position: r.rankOverall,
    predicted_ceiling_vorp: r.ceilingVorp,
    tier: r.tier,
  }));
  for (let i = 0; i < rows.length; i += BATCH) {
    const { error } = await supabase.from("nfl_fantasy_backtest_players").insert(rows.slice(i, i + BATCH));
    if (error) throw new Error(`nfl_fantasy_backtest_players insert failed at batch ${i}: ${error.message}`);
  }

  return run;
}
