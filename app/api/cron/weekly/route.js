// Runs at 3 PM UTC (10 AM CT) every Sunday — weekly recap email to all subscribers.
import { createClient } from "@supabase/supabase-js";
import { createHmac } from "crypto";
import { Resend } from "resend";
import { timingSafeEqual } from "../../../../lib/auth.js";

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://thisthatpicks.com";

function buildWeeklyHtml(wins, losses, bestPick, weekLabel) {
  const total = wins + losses;
  const pct = total > 0 ? Math.round((wins / total) * 100) : null;
  const rateColor = pct === null ? "#555" : pct >= 58 ? "#00FF87" : pct >= 52 ? "#FFD600" : "#FF6B6B";
  const trend = pct !== null && pct >= 55 ? "sharp week" : pct !== null && pct >= 50 ? "solid week" : "rough week";

  const fmtOdds = o => o == null ? "" : o > 0 ? ` (+${o})` : ` (${o})`;
  const pickOdds = bestPick ? (bestPick.pick === bestPick.homeTeam ? bestPick.homeOdds : bestPick.awayOdds) : null;

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#000;font-family:'Helvetica Neue',Arial,sans-serif;color:#fff;">
  <div style="max-width:480px;margin:0 auto;padding:32px 20px;">

    <div style="text-align:center;margin-bottom:28px;">
      <div style="font-size:24px;font-weight:700;letter-spacing:-1px;font-family:monospace;">
        T<span style="color:#00FF87;">|</span>T
      </div>
      <div style="font-size:11px;color:#333;letter-spacing:2px;margin-top:4px;">WEEKLY RECAP</div>
    </div>

    <div style="background:#080808;border:1px solid #1a1a1a;border-radius:14px;padding:22px;margin-bottom:20px;">
      <div style="font-size:11px;color:#444;letter-spacing:1.5px;margin-bottom:14px;">${weekLabel.toUpperCase()}</div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
        <div>
          <div style="font-family:'Courier New',monospace;font-size:36px;font-weight:700;color:${rateColor};">
            ${pct !== null ? `${pct}%` : "—"}
          </div>
          <div style="font-size:11px;color:#444;margin-top:2px;">WIN RATE</div>
        </div>
        <div style="text-align:right;">
          <div style="font-family:'Courier New',monospace;font-size:22px;font-weight:700;">${wins}–${losses}</div>
          <div style="font-size:11px;color:#444;margin-top:2px;">RECORD</div>
        </div>
      </div>
      <div style="height:3px;background:#111;border-radius:2px;margin-bottom:14px;">
        <div style="height:100%;border-radius:2px;width:${pct || 0}%;background:${rateColor};"></div>
      </div>
      <div style="font-size:13px;color:#555;line-height:1.6;">
        ${total === 0
          ? "No picks this week — check back Monday."
          : `A ${trend} — ${wins} win${wins !== 1 ? "s" : ""} out of ${total} calls.`}
      </div>
    </div>

    ${bestPick ? `
    <div style="background:#080808;border:1px solid #1a1a1a;border-radius:14px;padding:20px;margin-bottom:20px;">
      <div style="font-size:10px;color:#00FF87;letter-spacing:1.5px;font-weight:700;margin-bottom:10px;">TODAY'S BEST PICK</div>
      <div style="font-size:15px;font-weight:700;margin-bottom:4px;">${bestPick.awayTeam} @ ${bestPick.homeTeam}</div>
      <div style="font-size:14px;color:#00FF87;margin-bottom:6px;">Take ${bestPick.pick}${fmtOdds(pickOdds)}</div>
      ${bestPick.edge != null ? `<div style="font-size:12px;color:#444;">+${bestPick.edge.toFixed(1)}% edge</div>` : ""}
    </div>` : ""}

    <div style="text-align:center;margin-bottom:28px;">
      <a href="${APP_URL}" style="display:inline-block;background:#00FF87;color:#000;text-decoration:none;font-weight:800;font-size:14px;padding:12px 28px;border-radius:10px;">
        See Today's Full Picks →
      </a>
    </div>

    <div style="background:#060606;border:1px solid #111;border-radius:12px;padding:16px;margin-bottom:24px;text-align:center;">
      <div style="font-size:12px;color:#444;margin-bottom:8px;">Want all picks + AI breakdowns + edge scores?</div>
      <a href="${APP_URL}/landing" style="font-size:13px;color:#00FF87;text-decoration:none;font-weight:700;">Upgrade to Pro — $2/month →</a>
    </div>

    <div style="text-align:center;font-size:11px;color:#222;line-height:1.8;">
      <a href="${APP_URL}/landing" style="color:#222;text-decoration:none;">thisthatpicks.com</a>
      &nbsp;·&nbsp;
      <a href="${APP_URL}/api/unsubscribe?email={{email}}&token={{token}}" style="color:#222;text-decoration:none;">Unsubscribe</a>
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
  const resend = new Resend(process.env.RESEND_API_KEY);

  // Last 7 days of model performance
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 7);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  // ISO week identifier for the idempotency guard below.
  const weekKey = cutoffStr;

  // Idempotency guard — a retried/duplicated cron invocation must not re-send
  // the weekly recap to the whole list a second time (can't un-send an email).
  const { data: alreadySent } = await supabase
    .from("picks_cache").select("date").eq("date", `__weekly_${weekKey}__`).single();
  if (alreadySent) return Response.json({ sent: 0, reason: "already sent this week" });

  const { data: weekStats } = await supabase
    .from("model_daily_stats")
    .select("wins, losses")
    .gte("date", cutoffStr);

  const wins = (weekStats || []).reduce((s, r) => s + (r.wins || 0), 0);
  const losses = (weekStats || []).reduce((s, r) => s + (r.losses || 0), 0);

  // Today's best pick for Sunday preview
  const ctParts = (d) => {
    const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
    return `${p.find(x => x.type === "year").value}-${p.find(x => x.type === "month").value}-${p.find(x => x.type === "day").value}`;
  };
  const today = ctParts(new Date());
  const { data: cached } = await supabase.from("picks_cache").select("picks").eq("date", today).single();
  const allPicks = cached?.picks || [];
  const bestPick = allPicks.find(p => p.filter?.verdict === "CLEAN") || allPicks.find(p => p.isBet) || null;

  const weekStart = new Date(cutoff);
  const weekEnd = new Date();
  const weekLabel = `${weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${weekEnd.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;

  const html = buildWeeklyHtml(wins, losses, bestPick, weekLabel);
  const subject = wins + losses === 0
    ? "T|T Weekly — Check in on Sunday"
    : `T|T Weekly: ${wins}–${losses} last 7 days${wins > losses ? " ✅" : wins < losses ? " 📉" : ""}`;

  const { data: subscribers } = await supabase.from("email_list").select("email");
  if (!subscribers?.length) return Response.json({ sent: 0, reason: "no subscribers" });

  const fromAddr = process.env.RESEND_FROM || "T|T Picks <onboarding@resend.dev>";

  let sent = 0, failed = 0;
  const BATCH = 50;
  for (let i = 0; i < subscribers.length; i += BATCH) {
    const batch = subscribers.slice(i, i + BATCH);
    const results = await Promise.all(batch.map(({ email }) => {
      const token = createHmac("sha256", process.env.SUPABASE_SERVICE_ROLE_KEY || "").update(email).digest("hex");
      return resend.emails.send({
        from: fromAddr,
        to: email,
        subject,
        html: html.replace("{{email}}", encodeURIComponent(email)).replace("{{token}}", token),
      }).then(() => ({ ok: true })).catch(err => ({ ok: false, err: err.message }));
    }));
    for (const r of results) {
      if (r.ok) sent++;
      else failed++;
    }
  }

  if (sent > 0) {
    await supabase.from("picks_cache").upsert(
      { date: `__weekly_${weekKey}__`, picks: [], generated_at: new Date().toISOString() },
      { onConflict: "date" }
    );
  }

  return Response.json({ sent, failed, weekRecord: `${wins}-${losses}`, weekLabel });
}
