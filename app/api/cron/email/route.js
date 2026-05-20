// Runs at 11 AM UTC (7 AM ET) daily — sends today's free pick to email list.
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { timingSafeEqual } from "../../../../lib/auth.js";

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://tot-app.vercel.app";

function buildEmailHtml(pick) {
  const verdict = pick.filter?.verdict || "BET";
  const verdictColor = { CLEAN: "#00FF87", BET: "#FFD600" }[verdict] || "#00FF87";
  const verdictLabel = verdict === "CLEAN" ? "🔥 Value Pick" : "✅ Solid Pick";
  const odds = pick.pick === pick.homeTeam ? pick.homeOdds : pick.awayOdds;
  const fmtOdds = o => o == null ? "" : o > 0 ? ` (+${o})` : ` (${o})`;
  const preview = (pick.breakdown?.preview || "").slice(0, 200);
  const gameTime = pick.commenceTime
    ? new Date(pick.commenceTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/New_York" }) + " ET"
    : "";

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#000;font-family:'Helvetica Neue',Arial,sans-serif;color:#fff;">
  <div style="max-width:480px;margin:0 auto;padding:32px 20px;">

    <div style="text-align:center;margin-bottom:28px;">
      <div style="font-size:24px;font-weight:700;letter-spacing:-1px;font-family:monospace;">
        T<span style="color:#00FF87;">|</span>T
      </div>
      <div style="font-size:11px;color:#333;letter-spacing:2px;margin-top:4px;">TODAY'S FREE PICK</div>
    </div>

    <div style="background:#080808;border:1px solid #1a1a1a;border-radius:14px;padding:20px;margin-bottom:24px;">
      <div style="font-size:15px;font-weight:700;margin-bottom:8px;">
        ${pick.awayTeam} @ ${pick.homeTeam}
      </div>
      <div style="font-size:12px;color:#444;margin-bottom:14px;">${gameTime}</div>
      <div style="margin-bottom:14px;">
        <span style="font-size:11px;font-weight:800;padding:3px 10px;border-radius:6px;letter-spacing:1.5px;background:${verdictColor}1a;color:${verdictColor};border:1px solid ${verdictColor}44;">
          ${verdictLabel}
        </span>
      </div>
      <div style="font-size:15px;margin-bottom:12px;">
        Take <strong style="color:#00FF87;">${pick.pick}</strong>${fmtOdds(odds)}
      </div>
      ${preview ? `<div style="font-size:13px;color:#555;line-height:1.6;">${preview}</div>` : ""}
    </div>

    <div style="text-align:center;margin-bottom:28px;">
      <a href="${APP_URL}" style="display:inline-block;background:#00FF87;color:#000;text-decoration:none;font-weight:800;font-size:14px;padding:12px 28px;border-radius:10px;">
        See Full Breakdown →
      </a>
    </div>

    <div style="text-align:center;font-size:11px;color:#222;line-height:1.8;">
      <a href="${APP_URL}/landing" style="color:#222;text-decoration:none;">tot-app.vercel.app</a>
      &nbsp;·&nbsp;
      <a href="${APP_URL}/api/unsubscribe?email={{email}}" style="color:#222;text-decoration:none;">Unsubscribe</a>
    </div>
  </div>
</body>
</html>`;
}

export async function GET(request) {
  const authHeader = request.headers.get("authorization")?.replace("Bearer ", "");
  if (!timingSafeEqual(authHeader, process.env.CRON_SECRET)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.RESEND_API_KEY) {
    return Response.json({ error: "RESEND_API_KEY not set" }, { status: 500 });
  }

  const supabase = getSupabase();
  const resend   = new Resend(process.env.RESEND_API_KEY);

  // Get today's free pick from cache
  const date = new Date().toISOString().split("T")[0];
  const { data: cached } = await supabase.from("picks_cache").select("picks").eq("date", date).single();
  const picks = cached?.picks || [];
  const pick  = picks.find(p => p.filter?.verdict === "CLEAN") || picks.find(p => p.isBet) || null;

  if (!pick) return Response.json({ sent: 0, reason: "no pick today" });

  // Get all subscribers
  const { data: subscribers } = await supabase.from("email_list").select("email");
  if (!subscribers?.length) return Response.json({ sent: 0, reason: "no subscribers" });

  const html    = buildEmailHtml(pick);
  const subject = `Today's Pick: ${pick.awayTeam} @ ${pick.homeTeam} — Take ${pick.pick}`;

  // Send in batches of 50 (Resend rate limit)
  let sent = 0;
  const BATCH = 50;
  for (let i = 0; i < subscribers.length; i += BATCH) {
    const batch = subscribers.slice(i, i + BATCH);
    await Promise.all(batch.map(({ email }) =>
      resend.emails.send({
        from:    "T|T Picks <picks@thisorthatpicks.com>",
        to:      email,
        subject,
        html:    html.replace("{{email}}", encodeURIComponent(email)),
      }).catch(err => console.error(`Failed to send to ${email}:`, err.message))
    ));
    sent += batch.length;
  }

  return Response.json({ sent, date, pick: `${pick.awayTeam} @ ${pick.homeTeam}` });
}
