import { createClient } from "@supabase/supabase-js";

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const { data } = await supabase
    .from("model_daily_stats")
    .select("wins, losses");

  if (!data?.length) return Response.json({ wins: 0, losses: 0, pct: null });

  const wins   = data.reduce((s, r) => s + (r.wins   || 0), 0);
  const losses = data.reduce((s, r) => s + (r.losses || 0), 0);
  const total  = wins + losses;
  const pct    = total > 0 ? Math.round((wins / total) * 1000) / 10 : null;

  return Response.json({ wins, losses, pct, total });
}
