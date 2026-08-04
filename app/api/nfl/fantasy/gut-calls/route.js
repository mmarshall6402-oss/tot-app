// Personal gut-vs-model tracking (sql/019) — the pitch's "don't fight the
// gut, log it" piece. POST records which player a user actually says
// they're starting, alongside what the model favored at that moment; GET
// returns their running record (agree/disagree now, win/loss once a
// resolution job exists to fill in actual_winner). Auth-required, unlike
// the public model-calibration endpoint, since this is per-user data.
import { createClient } from "@supabase/supabase-js";
import { requireAuth } from "../../../../../lib/auth.js";
import { resolveHeadToHead } from "../../../../../lib/nfl-fantasy/head-to-head.js";
import { normalizeFormat } from "../../../../../lib/nfl-fantasy/lookup.js";
import { currentNflSeason, fetchCurrentNflWeek } from "../../../../../lib/nfl-fantasy/season.js";

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function POST(request) {
  const { user, error: authError } = await requireAuth(request);
  if (authError) return authError;

  let body;
  try { body = await request.json(); } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { playerA, playerB, gutPick, scoring } = body;
  if (!playerA?.trim() || !playerB?.trim()) {
    return Response.json({ error: "playerA and playerB required" }, { status: 400 });
  }
  if (gutPick !== "A" && gutPick !== "B") {
    return Response.json({ error: "gutPick must be 'A' or 'B'" }, { status: 400 });
  }

  const [resolved, week] = await Promise.all([
    resolveHeadToHead(playerA.trim(), playerB.trim(), scoring),
    fetchCurrentNflWeek(),
  ]);
  if (!resolved) {
    return Response.json({ error: "Could not find projections for one or both players — only ranked players can be logged." }, { status: 404 });
  }
  const { probability, rowA, rowB } = resolved;
  const modelPick = probability.playerAProbability >= 50 ? "A" : "B";

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("fantasy_gut_calls")
    .insert({
      user_id: user.id,
      scoring_format: normalizeFormat(scoring),
      season: currentNflSeason(),
      week: week ?? null,
      player_a_id: rowA.player_id || null,
      player_a_name: rowA.name,
      player_b_id: rowB.player_id || null,
      player_b_name: rowB.name,
      model_prob_a: probability.playerAProbability,
      model_pick: modelPick,
      gut_pick: gutPick,
    })
    .select("id")
    .single();
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({
    logged: true,
    id: data.id,
    agreedWithModel: modelPick === gutPick,
    playerAName: rowA.name,
    playerBName: rowB.name,
    modelPick,
    modelProbA: probability.playerAProbability,
    gutPick,
  });
}

export async function GET(request) {
  const { user, error: authError } = await requireAuth(request);
  if (authError) return authError;

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("fantasy_gut_calls")
    .select("id, player_a_name, player_b_name, model_pick, model_prob_a, gut_pick, actual_winner, resolved, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const rows = data || [];
  const agreed = rows.filter((r) => r.gut_pick === r.model_pick).length;
  const resolvedRows = rows.filter((r) => r.resolved && (r.actual_winner === "A" || r.actual_winner === "B"));
  const gutWins = resolvedRows.filter((r) => r.gut_pick === r.actual_winner).length;
  const modelWins = resolvedRows.filter((r) => r.model_pick === r.actual_winner).length;

  return Response.json({
    calls: rows,
    summary: {
      total: rows.length,
      agreed,
      disagreed: rows.length - agreed,
      resolved: resolvedRows.length,
      gutRecord: resolvedRows.length ? `${gutWins}-${resolvedRows.length - gutWins}` : null,
      modelRecord: resolvedRows.length ? `${modelWins}-${resolvedRows.length - modelWins}` : null,
    },
  });
}
