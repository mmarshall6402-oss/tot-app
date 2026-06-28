import { createClient } from "@supabase/supabase-js";

const getSupabase = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export async function GET(request) {
  const limit = Math.min(
    parseInt(new URL(request.url).searchParams.get("limit") || "60"),
    200
  );

  const { data, error } = await getSupabase()
    .from("calibration_snapshots")
    .select("id, run_at, total_picks, brier_score, log_loss, avg_delta, prob_buckets, conf_buckets, verdict_buckets, variance_buckets")
    .order("run_at", { ascending: false })
    .limit(limit);

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ snapshots: data || [] });
}
