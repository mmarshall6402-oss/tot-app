import { createClient } from "@supabase/supabase-js";
import { requireAuth } from "../../../lib/auth.js";

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function GET(request) {
  const { error } = await requireAuth(request);
  if (error) return error;

  const { data } = await getSupabase()
    .from("model_picks")
    .select("date, result, is_bet")
    .eq("is_bet", true)
    .in("result", ["win", "loss", "push"])
    .order("date", { ascending: true });

  const byDate = {};
  for (const row of data || []) {
    if (!byDate[row.date]) byDate[row.date] = { wins: 0, losses: 0, pushes: 0 };
    if (row.result === "win")  byDate[row.date].wins++;
    if (row.result === "loss") byDate[row.date].losses++;
    if (row.result === "push") byDate[row.date].pushes++;
  }

  return Response.json(byDate);
}
