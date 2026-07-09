// Public aggregate NFL track record — powers the landing page's Record tab
// (app/page.js NFLSection). Mirrors app/api/daily-record/route.js's role for MLB,
// but sources from nfl_model_picks (which already retains per-pick odds, needed
// for a unit P&L calc) rather than needing a separate live-resolve step — NFL
// picks are graded by app/api/cron/nfl-resolve well before this is likely to be read.

import { createClient } from "@supabase/supabase-js";

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Flat 1-unit-risk P&L for a single graded pick.
function unitsFor(odds, result) {
  if (result === "push") return 0;
  if (result === "loss") return -1;
  if (odds == null) return 1; // no odds on record — treat as even money
  return odds > 0 ? odds / 100 : 100 / Math.abs(odds);
}

export async function GET() {
  const supabase = getSupabase();
  try {
    const { data: rows, error } = await supabase
      .from("nfl_model_picks")
      .select("odds, result")
      .eq("is_bet", true)
      .eq("season_type", "regular") // exclude preseason test runs — see sql/003_nfl_preseason.sql
      .in("result", ["win", "loss", "push"]);

    if (error) throw error;

    const wins = (rows || []).filter(r => r.result === "win").length;
    const losses = (rows || []).filter(r => r.result === "loss").length;
    const pushes = (rows || []).filter(r => r.result === "push").length;
    const decided = wins + losses;
    const atsPct = decided > 0 ? Math.round((wins / decided) * 100) : null;
    const units = (rows || []).reduce((sum, r) => sum + unitsFor(r.odds, r.result), 0);

    return Response.json({ wins, losses, pushes, atsPct, units: parseFloat(units.toFixed(2)) });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
