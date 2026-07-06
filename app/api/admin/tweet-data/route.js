// Feeds app/admin/tweet/page.js. Previously that page queried model_picks/
// picks_cache directly with the anon Supabase client, relying entirely on
// table RLS policies instead of the app's real auth layer — this route puts
// it behind the same requireAuth + admin-email check every other admin route
// uses, and uses the service-role client so RLS isn't the only thing standing
// between an anon key and this data.
import { createClient } from "@supabase/supabase-js";
import { requireAuth } from "../../../../lib/auth.js";

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkAdmin(request) {
  const { user } = await requireAuth(request);
  if (!user) return false;
  const admins = (process.env.NEXT_PUBLIC_ADMIN_EMAILS || process.env.NEXT_PUBLIC_ADMIN_EMAIL || "")
    .split(",").map(e => e.trim().toLowerCase()).filter(Boolean);
  return admins.includes(user.email?.toLowerCase());
}

function etDate(offset = 0) {
  const d = new Date(Date.now() + offset * 86400000);
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  return `${p.find(x => x.type === "year").value}-${p.find(x => x.type === "month").value}-${p.find(x => x.type === "day").value}`;
}

export async function GET(request) {
  if (!(await checkAdmin(request))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabase();
  const today = etDate(0);
  const yesterday = etDate(-1);

  const { data: yPicks } = await supabase.from("model_picks").select("result,is_bet")
    .eq("date", yesterday).eq("is_bet", true).in("result", ["win", "loss", "push"]);
  const wins = (yPicks || []).filter(p => p.result === "win").length;
  const losses = (yPicks || []).filter(p => p.result === "loss").length;

  const { data: cached } = await supabase.from("picks_cache").select("picks").eq("date", today).single();
  const picks = (cached?.picks || []).filter(p => p.isBet)
    .sort((a, b) => (b.filter?.verdict === "CLEAN" ? 1000 : b.filter?.confidence || 0) - (a.filter?.verdict === "CLEAN" ? 1000 : a.filter?.confidence || 0))
    .slice(0, 3);

  return Response.json({ picks, record: { wins, losses, date: yesterday }, today, yesterday });
}
