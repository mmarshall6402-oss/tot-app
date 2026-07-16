import { createClient } from "@supabase/supabase-js";

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Returns the model's current consecutive daily W/L streak and last 7 days summary.
export async function GET() {
  try {
  const supabase = getSupabase();

  const { data } = await supabase
    .from("model_daily_stats")
    .select("date, wins, losses")
    .order("date", { ascending: false })
    .limit(30);

  if (!data?.length) return Response.json({ streak: 0, streakType: null, last7: { wins: 0, losses: 0 } });

  // Compute streak (days where model had a net win or net loss)
  let streak = 0;
  let streakType = null;
  for (const row of data) {
    if (row.wins === 0 && row.losses === 0) continue; // no-bet day, skip
    const dayResult = row.wins > row.losses ? "win" : row.losses > row.wins ? "loss" : null;
    if (dayResult === null) continue; // split day
    if (streakType === null) streakType = dayResult;
    if (dayResult === streakType) streak++;
    else break;
  }

  // Last 7 calendar days
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 7);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const last7Rows = data.filter(r => r.date >= cutoffStr);
  const last7 = {
    wins: last7Rows.reduce((s, r) => s + (r.wins || 0), 0),
    losses: last7Rows.reduce((s, r) => s + (r.losses || 0), 0),
  };

  return Response.json({ streak, streakType, last7 });
  } catch (e) {
    console.error("[streak] fatal:", e);
    return Response.json({ error: e?.message || e?.name || "unknown error" }, { status: 500 });
  }
}
