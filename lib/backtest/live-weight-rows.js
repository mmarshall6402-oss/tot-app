// lib/backtest/live-weight-rows.js
//
// Pulls resolved model_picks rows that carry weight_components (see
// app/api/cron/picks/route.js — stored on every pick generated after this
// was added) and reshapes them into {components, outcome, season} rows for
// lib/backtest/weight-search.js's searchWeightsFromComponents. Older picks
// generated before weight_components existed are silently skipped — there's
// no way to recover the raw per-factor differentials for them after the
// fact without re-fetching that day's MLB stats, which isn't reliably
// possible for past dates.

export async function fetchLiveWeightRows(supabase) {
  const { data, error } = await supabase
    .from("model_picks")
    .select("date, home_score, away_score, features")
    .not("home_score", "is", null)
    .not("away_score", "is", null);

  if (error || !data?.length) return [];

  return data
    .filter(r => r.features?.weight_components && r.home_score !== r.away_score)
    .map(r => ({
      components: r.features.weight_components,
      outcome: r.home_score > r.away_score ? 1 : 0,
      season: r.date.slice(0, 4),
    }));
}
