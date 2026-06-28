// Manual trigger: runs the same computation as the Lambda and writes a snapshot.
// Admin-only. Used from /admin/calibration to test without waiting for the nightly cron.
import { createClient } from "@supabase/supabase-js";
import { requireAuth } from "@/lib/auth";

const ADMIN_EMAILS = (process.env.NEXT_PUBLIC_ADMIN_EMAILS || process.env.NEXT_PUBLIC_ADMIN_EMAIL || "")
  .split(",").map(e => e.trim().toLowerCase()).filter(Boolean);

const getSupabase = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

function bucket(rows, field, ranges, clvRows) {
  return ranges.map(({ label, lo, hi, mid }) => {
    const f = r => (r.features || {})[field];
    const slice   = rows.filter(r => f(r) != null && f(r) >= lo && f(r) < hi);
    const wins    = slice.filter(r => r.result === "win").length;
    const clvSl   = clvRows.filter(r => f(r) != null && f(r) >= lo && f(r) < hi);
    const avgClv  = clvSl.length > 0
      ? parseFloat((clvSl.reduce((s, r) => s + r.features.clv, 0) / clvSl.length).toFixed(1))
      : null;
    return {
      label,
      predicted: mid ?? null,
      n:         slice.length,
      wins,
      actual:    slice.length > 0 ? parseFloat((wins / slice.length * 100).toFixed(1)) : null,
      avgClv,
      clvN:      clvSl.length,
    };
  });
}

export async function POST(request) {
  const { user, error: authErr } = await requireAuth(request);
  if (authErr) return authErr;
  if (!ADMIN_EMAILS.includes(user.email?.toLowerCase())) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("model_picks")
    .select("result, is_bet, features")
    .eq("is_bet", true)
    .in("result", ["win", "loss", "push"]);

  if (error) return Response.json({ error: error.message }, { status: 500 });

  const decided = (data || []).filter(r => r.result !== "push");
  const clvRows = (data || []).filter(r => r.features?.clv != null);

  if (!decided.length) return Response.json({ ok: false, error: "no resolved bets yet" });

  const probBuckets = bucket(decided, "true_win_prob_pct", [
    { label: "51–53%", lo: 51,  hi: 53,  mid: 52   },
    { label: "53–55%", lo: 53,  hi: 55,  mid: 54   },
    { label: "55–57%", lo: 55,  hi: 57,  mid: 56   },
    { label: "57–60%", lo: 57,  hi: 60,  mid: 58.5 },
    { label: "60–65%", lo: 60,  hi: 65,  mid: 62.5 },
    { label: "65%+",   lo: 65,  hi: 999, mid: 67   },
  ], clvRows);

  const confBuckets = bucket(decided, "confidence", [
    { label: "6.5–7.0", lo: 6.5, hi: 7.0  },
    { label: "7.0–7.5", lo: 7.0, hi: 7.5  },
    { label: "7.5–8.0", lo: 7.5, hi: 8.0  },
    { label: "8.0–8.5", lo: 8.0, hi: 8.5  },
    { label: "8.5+",    lo: 8.5, hi: 999  },
  ], clvRows);

  const verdictBuckets = ["CLEAN", "BET"].map(verdict => {
    const slice  = decided.filter(r => r.features?.verdict === verdict);
    const wins   = slice.filter(r => r.result === "win").length;
    const clvSl  = clvRows.filter(r => r.features?.verdict === verdict);
    const avgClv = clvSl.length > 0
      ? parseFloat((clvSl.reduce((s, r) => s + r.features.clv, 0) / clvSl.length).toFixed(1))
      : null;
    return { label: verdict, n: slice.length, wins, actual: slice.length > 0 ? parseFloat((wins / slice.length * 100).toFixed(1)) : null, avgClv, clvN: clvSl.length };
  });

  const varianceBuckets = ["LOW", "MED", "HIGH"].map(variance => {
    const slice = decided.filter(r => r.features?.variance === variance);
    const wins  = slice.filter(r => r.result === "win").length;
    return { label: variance, n: slice.length, wins, actual: slice.length > 0 ? parseFloat((wins / slice.length * 100).toFixed(1)) : null };
  }).filter(b => b.n > 0);

  const populated = probBuckets.filter(b => b.actual !== null && b.predicted !== null);
  const avgDelta  = populated.length > 0
    ? parseFloat((populated.reduce((s, b) => s + (b.actual - b.predicted), 0) / populated.length).toFixed(1))
    : null;

  // Brier score and log loss — scalar summary metrics
  const scored = decided.filter(r => r.features?.true_win_prob_pct != null);
  let brierScore = null, logLoss = null;
  if (scored.length > 0) {
    const eps = 1e-15;
    brierScore = parseFloat((scored.reduce((s, r) => {
      const p = r.features.true_win_prob_pct / 100;
      const y = r.result === "win" ? 1 : 0;
      return s + (p - y) ** 2;
    }, 0) / scored.length).toFixed(4));
    logLoss = parseFloat((-scored.reduce((s, r) => {
      const p = Math.max(eps, Math.min(1 - eps, r.features.true_win_prob_pct / 100));
      const y = r.result === "win" ? 1 : 0;
      return s + y * Math.log(p) + (1 - y) * Math.log(1 - p);
    }, 0) / scored.length).toFixed(4));
  }

  const snapshot = {
    total_picks:      decided.length,
    brier_score:      brierScore,
    log_loss:         logLoss,
    avg_delta:        avgDelta,
    prob_buckets:     probBuckets,
    conf_buckets:     confBuckets,
    verdict_buckets:  verdictBuckets,
    variance_buckets: varianceBuckets,
  };

  const { error: insertErr } = await supabase.from("calibration_snapshots").insert(snapshot);
  if (insertErr) return Response.json({ error: insertErr.message }, { status: 500 });

  return Response.json({ ok: true, ...snapshot });
}
