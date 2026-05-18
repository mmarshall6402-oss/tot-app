import { createClient } from "@supabase/supabase-js";

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const days = parseInt(searchParams.get("days") || "0", 10);

  const supabase = getSupabase();
  let query = supabase.from("model_daily_stats").select("wins, losses, date");

  if (days > 0) {
    const since = new Date();
    since.setDate(since.getDate() - days);
    query = query.gte("date", since.toISOString().split("T")[0]);
  }

  const { data } = await query;
  if (!data?.length) return Response.json({ wins: 0, losses: 0, pct: null, total: 0, days: days || "all" });

  const wins   = data.reduce((s, r) => s + (r.wins   || 0), 0);
  const losses = data.reduce((s, r) => s + (r.losses || 0), 0);
  const total  = wins + losses;
  const pct    = total > 0 ? Math.round((wins / total) * 1000) / 10 : null;

  return Response.json({ wins, losses, pct, total, days: days || "all" });
}
