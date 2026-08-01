// Private admin route — fantasy rankings backtest.
// GET returns the latest cached run (never recomputes on page load).
// POST triggers a fresh run in-process against the cached nflverse data
// written by scripts/nfl-fantasy/fetch-nflverse.js.
import { readFile } from "fs/promises";
import { join } from "path";
import { createClient } from "@supabase/supabase-js";
import { requireAuth } from "../../../../lib/auth.js";
import { runFantasyBacktest } from "../../../../lib/nfl-fantasy/backtest-runner.js";
import { persistFantasyBacktestRun } from "../../../../lib/nfl-fantasy/persist-backtest.js";

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

export async function GET(request) {
  if (!await checkAuth(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const season = searchParams.get("season");

  const sb = getSupabase();
  let query = sb.from("nfl_fantasy_backtest_runs").select("*").order("run_at", { ascending: false }).limit(1);
  if (season) query = query.eq("target_season", parseInt(season, 10));
  const { data: runs, error: runErr } = await query;

  if (runErr) return Response.json({ error: runErr.message }, { status: 500 });
  const run = runs?.[0] || null;
  if (!run) return Response.json({ run: null, players: [] });

  const { data: players, error: playersErr } = await sb
    .from("nfl_fantasy_backtest_players")
    .select("name, position, predicted_rank_position, predicted_ceiling_vorp, actual_points, actual_rank_position, tier")
    .eq("run_id", run.id)
    .order("predicted_rank_position", { ascending: true });

  if (playersErr) return Response.json({ error: playersErr.message }, { status: 500 });

  return Response.json({ run, players: players || [] });
}

export async function POST(request) {
  if (!await checkAuth(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const targetSeason = body.season || new Date().getFullYear();
  const format = body.format || "ppr";

  let playerStatsRows, playersRows;
  try {
    const raw = await readFile(join(process.cwd(), "data/nflverse/player_stats.json"), "utf8");
    playerStatsRows = JSON.parse(raw);
    playersRows = JSON.parse(await readFile(join(process.cwd(), "data/nflverse/players.json"), "utf8").catch(() => "[]"));
  } catch (e) {
    return Response.json({ error: `failed to load cached nflverse data — run 'npm run fantasy-fetch' first: ${e.message}` }, { status: 500 });
  }

  const result = runFantasyBacktest({ playerStatsRows, playersRows, targetSeason, format });
  const run = await persistFantasyBacktestRun(getSupabase(), result);
  return Response.json({ run, metrics: result.metrics });
}
