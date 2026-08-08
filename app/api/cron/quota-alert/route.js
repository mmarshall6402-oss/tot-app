// app/api/cron/quota-alert/route.js
// Runs once daily. Reads the latest api_quota_log snapshot (captured off real
// The Odds API traffic — see lib/quota-log.js) and emails the admin list if
// requests_remaining has dropped below TOA_QUOTA_ALERT_THRESHOLD. Once/day
// keeps this naturally non-spammy without needing a separate "already sent
// today" flag.

import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { timingSafeEqual } from "../../../../lib/auth.js";

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const DEFAULT_THRESHOLD = 20;

export async function GET(request) {
  const authHeader = request.headers.get("authorization")?.replace("Bearer ", "");
  if (!timingSafeEqual(authHeader, process.env.CRON_SECRET)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const threshold = parseInt(process.env.TOA_QUOTA_ALERT_THRESHOLD) || DEFAULT_THRESHOLD;
  const supabase = getSupabase();

  const { data: latest } = await supabase
    .from("api_quota_log")
    .select("requests_remaining, recorded_at")
    .eq("source", "toa")
    .order("recorded_at", { ascending: false })
    .limit(1)
    .single();

  const remaining = latest?.requests_remaining;
  if (remaining == null || remaining >= threshold) {
    return Response.json({ ok: true, alerted: false, remaining: remaining ?? null, threshold });
  }

  const admins = (process.env.NEXT_PUBLIC_ADMIN_EMAILS || process.env.NEXT_PUBLIC_ADMIN_EMAIL || "")
    .split(",").map(e => e.trim()).filter(Boolean);
  if (!admins.length || !process.env.RESEND_API_KEY) {
    return Response.json({ ok: true, alerted: false, remaining, threshold, reason: "no admin email or RESEND_API_KEY configured" });
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  const fromAddr = process.env.RESEND_FROM || "T|T Picks <onboarding@resend.dev>";
  const html = `<!DOCTYPE html><html><body style="background:#000;color:#fff;font-family:Arial,sans-serif;padding:32px 20px;max-width:480px;margin:0 auto;">
    <div style="font-size:24px;font-weight:700;font-family:monospace;margin-bottom:16px;">T<span style="color:#00FF87;">|</span>T</div>
    <div style="font-size:14px;color:#FF4D4D;margin-bottom:12px;">⚠️ The Odds API quota low</div>
    <div style="font-size:13px;color:#ccc;line-height:1.7;">
      <strong>${remaining}</strong> requests remaining (alert threshold: ${threshold}).<br/>
      Check the Rate Limits tab in /admin for the burn-rate trend, or top up at
      <a href="https://the-odds-api.com" style="color:#00FF87;">the-odds-api.com</a>.
    </div>
  </body></html>`;

  try {
    await resend.emails.send({ from: fromAddr, to: admins, subject: `[T|T] Odds API quota low — ${remaining} remaining`, html });
    return Response.json({ ok: true, alerted: true, remaining, threshold });
  } catch (e) {
    return Response.json({ ok: false, error: e.message });
  }
}
