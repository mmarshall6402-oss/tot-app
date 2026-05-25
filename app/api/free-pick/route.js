import { createClient } from "@supabase/supabase-js";

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function GET() {
  try {
    const ctParts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(new Date());
    const date = `${ctParts.find(p => p.type === "year").value}-${ctParts.find(p => p.type === "month").value}-${ctParts.find(p => p.type === "day").value}`;
    const supabase = getSupabase();

    const { data: cached } = await supabase
      .from("picks_cache")
      .select("picks")
      .eq("date", date)
      .single();

    const picks = cached?.picks || [];

    // Prefer CLEAN, then BET — never show a PASS pick
    const raw = picks.find(p => p.filter?.verdict === "CLEAN")
             || picks.find(p => p.isBet)
             || null;

    if (!raw) return Response.json({ pick: null });

    // Override tier from filter verdict — cached tier reflects edge magnitude
    // which is calibrated to 2-8%, but CLEAN/BET designation is the real signal.
    const verdict = raw.filter?.verdict;
    const tier = verdict === "CLEAN"
      ? { level: "High",   label: "🔥 Value Pick", emoji: "🔥" }
      : verdict === "BET" && (raw.filter?.confidence || 0) >= 7
      ? { level: "Medium", label: "✅ Solid Pick",  emoji: "✅" }
      : { level: "Low",    label: "👀 Lean",         emoji: "👀" };

    return Response.json({ pick: { ...raw, tier } });
  } catch (e) {
    return Response.json({ pick: null, error: e.message });
  }
}
