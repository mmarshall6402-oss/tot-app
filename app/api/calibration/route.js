// app/api/calibration/route.js
// Historical calibration analytics: predicted probability buckets vs actual win rate.
// Used to detect model overconfidence, underconfidence, and bucket-level distortion.
import { createClient } from "@supabase/supabase-js";

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function bucket(rows, field, ranges, clvRows) {
  return ranges.map(({ label, lo, hi, mid }) => {
    const slice   = rows.filter(r => { const v = r.features?.[field]; return v != null && v >= lo && v < hi; });
    const wins    = slice.filter(r => r.result === "win").length;
    const clvSlice = clvRows.filter(r => { const v = r.features?.[field]; return v != null && v >= lo && v < hi && r.features?.clv != null; });
    const avgClv  = clvSlice.length > 0
      ? parseFloat((clvSlice.reduce((s, r) => s + r.features.clv, 0) / clvSlice.length).toFixed(1))
      : null;
    return {
      label,
      predicted: mid ?? null,
      n:      slice.length,
      wins,
      actual: slice.length > 0 ? parseFloat((wins / slice.length * 100).toFixed(1)) : null,
      avgClv,
      clvN:   clvSlice.length,
    };
  });
}

export async function GET() {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("model_picks")
    .select("result, is_bet, features")
    .eq("is_bet", true)
    .in("result", ["win", "loss", "push"]);

  if (error || !data?.length) {
    return Response.json({ probBuckets: [], confBuckets: [], verdictBuckets: [], varianceBuckets: [], total: 0 });
  }

  // Exclude pushes from win rate denominators
  const decided = data.filter(r => r.result !== "push");
  const clvRows = data.filter(r => r.features?.clv != null);

  // ── Probability calibration ──
  // The core diagnostic: does a 57% predicted probability actually win 57% of the time?
  const probBuckets = bucket(decided, "true_win_prob_pct", [
    { label: "51–53%", lo: 51,   hi: 53,  mid: 52   },
    { label: "53–55%", lo: 53,   hi: 55,  mid: 54   },
    { label: "55–57%", lo: 55,   hi: 57,  mid: 56   },
    { label: "57–60%", lo: 57,   hi: 60,  mid: 58.5 },
    { label: "60–65%", lo: 60,   hi: 65,  mid: 62.5 },
    { label: "65%+",   lo: 65,   hi: 999, mid: 67   },
  ], clvRows);

  // ── Confidence calibration ──
  // Higher confidence should monotonically track higher win rate.
  // A non-monotone pattern signals confidence score miscalibration.
  const confBuckets = bucket(decided, "confidence", [
    { label: "6.5–7.0", lo: 6.5,  hi: 7.0, mid: null },
    { label: "7.0–7.5", lo: 7.0,  hi: 7.5, mid: null },
    { label: "7.5–8.0", lo: 7.5,  hi: 8.0, mid: null },
    { label: "8.0–8.5", lo: 8.0,  hi: 8.5, mid: null },
    { label: "8.5+",    lo: 8.5,  hi: 999, mid: null },
  ], clvRows);

  // ── Verdict calibration ──
  // CLEAN should outperform BET. If it doesn't, the AND-gate separation isn't adding value.
  const verdictBuckets = ["CLEAN", "BET"].map(verdict => {
    const slice   = decided.filter(r => r.features?.verdict === verdict);
    const wins    = slice.filter(r => r.result === "win").length;
    const clvSlice = clvRows.filter(r => r.features?.verdict === verdict);
    const avgClv  = clvSlice.length > 0
      ? parseFloat((clvSlice.reduce((s, r) => s + r.features.clv, 0) / clvSlice.length).toFixed(1))
      : null;
    return { label: verdict, n: slice.length, wins, actual: slice.length > 0 ? parseFloat((wins / slice.length * 100).toFixed(1)) : null, avgClv, clvN: clvSlice.length };
  });

  // ── Variance calibration ──
  // HIGH variance BETs (post-override) should be tracked separately.
  const varianceBuckets = ["LOW", "MED", "HIGH"].map(variance => {
    const slice = decided.filter(r => r.features?.variance === variance);
    const wins  = slice.filter(r => r.result === "win").length;
    return { label: variance, n: slice.length, wins, actual: slice.length > 0 ? parseFloat((wins / slice.length * 100).toFixed(1)) : null };
  }).filter(b => b.n > 0);

  // ── Overall bias check ──
  // avgDelta: mean of (actual - predicted) across all buckets with data.
  // Positive = model systematically underconfident, negative = overconfident.
  const populated = probBuckets.filter(b => b.actual !== null && b.predicted !== null);
  const avgDelta  = populated.length > 0
    ? parseFloat((populated.reduce((s, b) => s + (b.actual - b.predicted), 0) / populated.length).toFixed(1))
    : null;

  return Response.json({
    probBuckets,
    confBuckets,
    verdictBuckets,
    varianceBuckets,
    total: decided.length,
    avgDelta,
  });
}
