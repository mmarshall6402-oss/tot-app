import { Resend } from "resend";
import { requireAuth } from "../../../../lib/auth.js";
import { createClient } from "@supabase/supabase-js";

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function isAdmin(user) {
  const admins = (process.env.NEXT_PUBLIC_ADMIN_EMAILS || process.env.NEXT_PUBLIC_ADMIN_EMAIL || "")
    .split(",").map(e => e.trim().toLowerCase()).filter(Boolean);
  return admins.includes(user.email?.toLowerCase());
}

export async function POST(request) {
  const { user, error } = await requireAuth(request);
  if (error) return error;
  if (!isAdmin(user)) return Response.json({ error: "Forbidden" }, { status: 403 });

  if (!process.env.RESEND_API_KEY) return Response.json({ error: "RESEND_API_KEY not set" }, { status: 500 });

  const { to } = await request.json();
  if (!to) return Response.json({ error: "to required" }, { status: 400 });

  const supabase = getSupabase();
  const ctParts = (d) => {
    const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
    return `${p.find(x => x.type === "year").value}-${p.find(x => x.type === "month").value}-${p.find(x => x.type === "day").value}`;
  };
  const today = ctParts(new Date());
  const { data: cached } = await supabase.from("picks_cache").select("picks").eq("date", today).single();
  const picks = cached?.picks || [];
  const pick = picks.find(p => p.filter?.verdict === "CLEAN") || picks.find(p => p.isBet) || picks[0] || null;

  const fromAddr = process.env.RESEND_FROM || "T|T Picks <onboarding@resend.dev>";
  const resend = new Resend(process.env.RESEND_API_KEY);

  const subject = pick
    ? `[TEST] Today's Pick: ${pick.awayTeam} @ ${pick.homeTeam} — Take ${pick.pick}`
    : "[TEST] T|T Picks — email test";

  const html = `<!DOCTYPE html><html><body style="background:#000;color:#fff;font-family:Arial,sans-serif;padding:32px 20px;max-width:480px;margin:0 auto;">
    <div style="font-size:24px;font-weight:700;font-family:monospace;margin-bottom:16px;">T<span style="color:#00FF87;">|</span>T</div>
    <div style="font-size:14px;color:#00FF87;margin-bottom:12px;">✓ Email is working!</div>
    <div style="font-size:13px;color:#666;margin-bottom:20px;">Sent from: <span style="color:#fff;">${fromAddr}</span></div>
    ${pick ? `<div style="background:#0a0a0a;border:1px solid #1a1a1a;border-radius:12px;padding:16px;">
      <div style="font-size:13px;color:#777;margin-bottom:6px;">Today's top pick:</div>
      <div style="font-size:15px;font-weight:700;">${pick.awayTeam} @ ${pick.homeTeam}</div>
      <div style="font-size:13px;color:#00FF87;margin-top:6px;">Take ${pick.pick}</div>
      ${pick.breakdown?.preview ? `<div style="font-size:12px;color:#555;margin-top:8px;line-height:1.6;">${pick.breakdown.preview.slice(0, 200)}</div>` : ""}
    </div>` : `<div style="color:#555;font-size:13px;">No picks cached for today yet.</div>`}
    <div style="margin-top:24px;font-size:11px;color:#333;">Test sent from T|T admin dashboard</div>
  </body></html>`;

  try {
    const result = await resend.emails.send({ from: fromAddr, to, subject, html });
    if (result.error) return Response.json({ error: result.error.message }, { status: 400 });
    return Response.json({ ok: true, id: result.data?.id, from: fromAddr, to });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
