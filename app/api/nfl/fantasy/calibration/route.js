// Public calibration analytics for the fantasy Start/Sit probability model —
// the fantasy analog of /api/calibration (MLB betting picks). Deliberately
// no auth: this is meant to be a public trust artifact (app/calibration/page.js),
// same "no phantom edges" posture the betting-picks product already has.
import { createClient } from "@supabase/supabase-js";

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const BUCKETS = [
  { label: "50-55%", lo: 50, hi: 55 },
  { label: "55-60%", lo: 55, hi: 60 },
  { label: "60-65%", lo: 60, hi: 65 },
  { label: "65-70%", lo: 65, hi: 70 },
  { label: "70-80%", lo: 70, hi: 80 },
  { label: "80-90%", lo: 80, hi: 90 },
  { label: "90%+", lo: 90, hi: 101 },
];

export async function GET() {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("fantasy_probability_log")
      .select("predicted_prob_a, actual_winner, season")
      .eq("resolved", true)
      .in("actual_winner", ["A", "B"]); // pushes excluded from the win-rate denominator, same convention as /api/calibration

    if (error) return Response.json({ error: error.message }, { status: 500 });
    if (!data?.length) return Response.json({ buckets: [], total: 0, avgDelta: null, seasons: [] });

    // predicted_prob_a is arbitrarily A-vs-B — fold each row onto whichever
    // side the model actually favored before bucketing, so "60-65%" always
    // means "the favorite was given 60-65%," not a meaningless mix of both
    // directions around 50%.
    const favored = data.map((r) => {
      const favProb = r.predicted_prob_a >= 50 ? r.predicted_prob_a : 100 - r.predicted_prob_a;
      const favoriteWon = (r.predicted_prob_a >= 50 && r.actual_winner === "A") || (r.predicted_prob_a < 50 && r.actual_winner === "B");
      return { favProb, favoriteWon, season: r.season };
    });

    const buckets = BUCKETS.map(({ label, lo, hi }) => {
      const slice = favored.filter((r) => r.favProb >= lo && r.favProb < hi);
      const wins = slice.filter((r) => r.favoriteWon).length;
      return {
        label,
        n: slice.length,
        predicted: slice.length ? parseFloat((slice.reduce((s, r) => s + r.favProb, 0) / slice.length).toFixed(1)) : null,
        actual: slice.length ? parseFloat((wins / slice.length * 100).toFixed(1)) : null,
      };
    });

    const populated = buckets.filter((b) => b.n >= 20 && b.actual != null);
    const avgDelta = populated.length
      ? parseFloat((populated.reduce((s, b) => s + (b.actual - b.predicted), 0) / populated.length).toFixed(1))
      : null;

    const seasons = [...new Set(favored.map((r) => r.season))].sort();

    return Response.json({ buckets, total: favored.length, avgDelta, seasons });
  } catch (e) {
    console.error("[fantasy calibration] fatal:", e);
    return Response.json({ error: e?.message || e?.name || "unknown error" }, { status: 500 });
  }
}
