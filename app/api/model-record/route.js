import { createClient } from "@supabase/supabase-js";

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function GET() {
  const supabase = getSupabase();

  const { data } = await supabase
    .from("model_picks")
    .select("result, is_bet, tier, edge")
    .in("result", ["win", "loss", "push"]);

  if (!data?.length) return Response.json({ wins: 0, losses: 0, pushes: 0, pct: null, total: 0 });

  const wins   = data.filter(r => r.result === "win").length;
  const losses = data.filter(r => r.result === "loss").length;
  const pushes = data.filter(r => r.result === "push").length;
  const total  = wins + losses; // pushes excluded from win rate
  const pct    = total > 0 ? Math.round((wins / total) * 1000) / 10 : null;

  const byTier = ["High", "Medium", "Low"].map(tier => {
    const picks  = data.filter(r => r.tier === tier);
    const tWins  = picks.filter(r => r.result === "win").length;
    const tTotal = picks.filter(r => r.result !== "push").length;
    return { tier, wins: tWins, total: tTotal, pct: tTotal > 0 ? Math.round((tWins / tTotal) * 1000) / 10 : null };
  });

  const avgEdge = data.length > 0
    ? Math.round(data.reduce((s, r) => s + (r.edge || 0), 0) / data.length * 10) / 10
    : null;

  return Response.json({ wins, losses, pushes, pct, total, byTier, avgEdge });
}
