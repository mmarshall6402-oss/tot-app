// app/api/player/route.js
// Player homepage data — bio, season stats, recent game log, and (MLB only)
// any active Trending Prop pick for today, tying the player page into the
// K's/HR's props feature.
import { createClient } from "@supabase/supabase-js";
import { requireAuth } from "../../../lib/auth.js";
import { fetchMLBPlayerDetail } from "../../../lib/mlb-players.js";
import { fetchNFLPlayerDetail } from "../../../lib/nfl-roster.js";

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

async function findTrendingPick(playerId) {
  if (!playerId) return null;
  try {
    const supabase = getSupabase();
    const ctParts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(new Date());
    const today = `${ctParts.find(p => p.type === "year").value}-${ctParts.find(p => p.type === "month").value}-${ctParts.find(p => p.type === "day").value}`;

    const { data } = await supabase.from("prop_picks_cache").select("picks").eq("date", today).single();
    const picks = data?.picks || [];
    return picks.find(p => String(p.playerId) === String(playerId)) || null;
  } catch {
    return null;
  }
}

export async function GET(request) {
  const { error: authError } = await requireAuth(request);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const sport = (searchParams.get("sport") || "mlb").toLowerCase();
  const id = searchParams.get("id");
  if (!id) return Response.json({ error: "id required" }, { status: 400 });

  try {
    const detail = sport === "nfl" ? await fetchNFLPlayerDetail(id) : await fetchMLBPlayerDetail(id);
    if (!detail) return Response.json({ error: "player not found" }, { status: 404 });

    if (sport === "mlb") {
      detail.trendingPick = await findTrendingPick(detail.id);
    }

    return Response.json(detail);
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
