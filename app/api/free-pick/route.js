import { createClient } from "@supabase/supabase-js";

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function GET() {
  try {
    const date = new Date().toISOString().split("T")[0];
    const supabase = getSupabase();

    const { data: cached } = await supabase
      .from("picks_cache")
      .select("picks")
      .eq("date", date)
      .single();

    const picks = cached?.picks || [];

    // Prefer CLEAN, then BET — never show a PASS pick
    const pick = picks.find(p => p.filter?.verdict === "CLEAN")
              || picks.find(p => p.isBet)
              || null;

    return Response.json({ pick });
  } catch (e) {
    return Response.json({ pick: null, error: e.message });
  }
}
