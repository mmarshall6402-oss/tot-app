// app/api/admin/backtest/route.js
// Private admin route — historical backtesting/calibration engine.
// GET returns the latest cached run (never recomputes on page load).
// POST triggers a fresh run in-process (batch job, not a live request path).

import { createClient } from "@supabase/supabase-js";
import { requireAuth } from "../../../../lib/auth.js";
import { runTier1 } from "../../../../lib/backtest/tier1-runner.js";
import { runTier2 } from "../../../../lib/backtest/tier2-runner.js";
import { persistRun } from "../../../../lib/backtest/persist.js";

// Create client lazily — env vars not available at build time
const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkAuth(request) {
  const { user } = await requireAuth(request);
  if (!user) return false;
  const admins = (process.env.NEXT_PUBLIC_ADMIN_EMAILS || process.env.NEXT_PUBLIC_ADMIN_EMAIL || "")
    .split(",").map(e => e.trim().toLowerCase()).filter(Boolean);
  return admins.includes(user.email?.toLowerCase());
}

// ─────────────────────────────────────────────
// GET: fetch the latest run + its games (summarized)
// ─────────────────────────────────────────────
export async function GET(request) {
  if (!await checkAuth(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const tier = searchParams.get("tier"); // optional filter: 'elo_only' | 'full_replay' | 'roi_real_odds'

  const sb = getSupabase();

  let query = sb.from("backtest_runs").select("*").order("run_at", { ascending: false }).limit(1);
  if (tier) query = query.eq("tier", tier);
  const { data: runs, error: runErr } = await query;

  if (runErr) return Response.json({ error: runErr.message }, { status: 500 });
  const run = runs?.[0] || null;
  if (!run) return Response.json({ run: null, games: [] });

  const { data: games, error: gamesErr } = await sb
    .from("backtest_games")
    .select("date, home_team, away_team, home_won, model_home_prob, model_home_prob_calibrated, pick, verdict, confidence, true_edge_pct, market_home_implied, bet_result, bankroll_after")
    .eq("run_id", run.id)
    .order("date", { ascending: true });

  if (gamesErr) return Response.json({ error: gamesErr.message }, { status: 500 });

  return Response.json({ run, games: games || [] });
}

// ─────────────────────────────────────────────
// POST: trigger a fresh backtest run
// ─────────────────────────────────────────────
export async function POST(request) {
  if (!await checkAuth(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const tier = body.tier || 1;
  const seasons = body.seasons || null;

  let result;
  if (tier === 1) {
    result = runTier1({ seasons });
  } else if (tier === 2) {
    result = runTier2({ seasons });
  } else {
    return Response.json({ error: `Tier ${tier} is not implemented yet.` }, { status: 400 });
  }

  const run = await persistRun(getSupabase(), result);
  return Response.json({ run });
}
