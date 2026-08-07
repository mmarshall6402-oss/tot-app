// app/api/prop-lines/route.js
// Lets a signed-in user set a custom line on today's prop pick and persists
// it, keyed by (user, date, player, market) — see sql/019_user_prop_lines.sql
// for why that's the key instead of a prop_model_picks row id. Repricing math
// lives in lib/prop-probability.js's repriceAtLine so the client (live slider
// preview) and this route (authoritative save) can't drift apart.
import { createClient } from "@supabase/supabase-js";
import { requireAuth } from "../../../lib/auth.js";
import { repriceAtLine } from "../../../lib/prop-probability.js";

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Only markets whose lambda is "expected count of the stat" can be repriced
// by repriceAtLine's Poisson math (see its doc comment) — batter_hr's lambda
// is P(any HR), a different shape, so it's excluded until it gets its own
// reprice function.
const REPRICEABLE_MARKETS = new Set(["pitcher_k"]);
const MAX_LINE_DELTA = 3;

function ctDateStr(d = new Date()) {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(d);
  return `${p.find(x => x.type === "year").value}-${p.find(x => x.type === "month").value}-${p.find(x => x.type === "day").value}`;
}

async function todaysPick(supabase, playerId, marketType) {
  const date = ctDateStr();
  const { data } = await supabase.from("prop_picks_cache").select("picks").eq("date", date).single();
  const picks = data?.picks || [];
  const pick = picks.find(p => String(p.playerId) === String(playerId) && p.marketType === marketType) || null;
  return { date, pick };
}

export async function GET(request) {
  const { user, error: authError } = await requireAuth(request);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const playerId = searchParams.get("playerId");
  const marketType = searchParams.get("marketType");
  if (!playerId || !marketType) {
    return Response.json({ error: "playerId and marketType required" }, { status: 400 });
  }

  try {
    const supabase = getSupabase();
    const { date } = await todaysPick(supabase, playerId, marketType);
    const { data } = await supabase.from("user_prop_lines")
      .select("custom_line")
      .eq("user_id", user.id).eq("date", date).eq("player_id", String(playerId)).eq("market_type", marketType)
      .maybeSingle();
    return Response.json({ customLine: data?.custom_line ?? null });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(request) {
  const { user, error: authError } = await requireAuth(request);
  if (authError) return authError;

  try {
    const { playerId, marketType, customLine } = await request.json();
    if (!playerId || !marketType || customLine == null) {
      return Response.json({ error: "playerId, marketType, and customLine required" }, { status: 400 });
    }
    if (!REPRICEABLE_MARKETS.has(marketType)) {
      return Response.json({ error: "Line adjustment isn't available for this market yet" }, { status: 400 });
    }
    const line = Number(customLine);
    if (!Number.isFinite(line) || line <= 0 || Math.round(line * 2) !== line * 2) {
      return Response.json({ error: "Line must be a positive number in 0.5 increments" }, { status: 400 });
    }

    const supabase = getSupabase();
    const { date, pick } = await todaysPick(supabase, playerId, marketType);
    if (!pick) return Response.json({ error: "No active line found for this player today" }, { status: 404 });
    if (Math.abs(line - pick.line) > MAX_LINE_DELTA) {
      return Response.json({ error: `Line must be within ${MAX_LINE_DELTA} of today's line (${pick.line})` }, { status: 400 });
    }

    const repriced = repriceAtLine(pick.lambda, line);

    const { error: upsertError } = await supabase.from("user_prop_lines").upsert({
      user_id: user.id, date, player_id: String(playerId), market_type: marketType,
      custom_line: line, updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,date,player_id,market_type" });
    if (upsertError) throw upsertError;

    return Response.json({ customLine: line, ...repriced });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
