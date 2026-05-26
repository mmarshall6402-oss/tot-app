import { createClient } from "@supabase/supabase-js";

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function GET() {
  const supabase = getSupabase();

  const { data } = await supabase
    .from("model_picks")
    .select("result, is_bet, tier, edge, features")
    .in("result", ["win", "loss", "push"])
    .eq("is_bet", true);

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

  // CLV: closing_implied - open_implied for the picked side (stored in features by snapshot cron)
  const clvData = data.filter(r => r.features?.clv != null);
  const avgClv  = clvData.length > 0
    ? Math.round(clvData.reduce((s, r) => s + r.features.clv, 0) / clvData.length * 10) / 10
    : null;
  const pctPositiveClv = clvData.length > 0
    ? Math.round(clvData.filter(r => r.features.clv > 0).length / clvData.length * 1000) / 10
    : null;

  // CLV bucketed by edge size — reveals if large-edge picks are actually model noise.
  // Red flag: biggest edges = worst CLV = model is over-amplifying certainty at extremes.
  const edgeBuckets = [
    { label: "0-2%",  lo: 0, hi: 2   },
    { label: "2-4%",  lo: 2, hi: 4   },
    { label: "4-6%",  lo: 4, hi: 6   },
    { label: "6%+",   lo: 6, hi: 999 },
  ].map(({ label, lo, hi }) => {
    const bucket    = data.filter(r => (r.edge || 0) >= lo && (r.edge || 0) < hi);
    const bClv      = bucket.filter(r => r.features?.clv != null);
    const bWins     = bucket.filter(r => r.result === "win").length;
    const bTotal    = bucket.filter(r => r.result !== "push").length;
    const bAvgClv   = bClv.length > 0
      ? Math.round(bClv.reduce((s, r) => s + r.features.clv, 0) / bClv.length * 10) / 10
      : null;
    return {
      label,
      wins: bWins, total: bTotal,
      pct: bTotal > 0 ? Math.round(bWins / bTotal * 1000) / 10 : null,
      avgClv: bAvgClv,
      clvSamples: bClv.length,
    };
  });

  return Response.json({ wins, losses, pushes, pct, total, byTier, avgEdge, avgClv, pctPositiveClv, clvSampleSize: clvData.length, edgeBuckets });
}
