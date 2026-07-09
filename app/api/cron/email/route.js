// Runs at 3:30 PM UTC (10:30 AM CT) daily — sends today's free pick to email list.
import { createClient } from "@supabase/supabase-js";
import { createHmac } from "crypto";
import { Resend } from "resend";
import { timingSafeEqual } from "../../../../lib/auth.js";

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://thisthatpicks.com";

function shortName(team) {
  const map = {
    "Oakland Athletics":"Athletics","Los Angeles Angels":"Angels","Los Angeles Dodgers":"Dodgers",
    "New York Yankees":"Yankees","New York Mets":"Mets","Chicago White Sox":"White Sox",
    "Chicago Cubs":"Cubs","Boston Red Sox":"Red Sox","Tampa Bay Rays":"Rays",
    "San Francisco Giants":"Giants","San Diego Padres":"Padres","Kansas City Royals":"Royals",
    "Toronto Blue Jays":"Blue Jays","Colorado Rockies":"Rockies","Minnesota Twins":"Twins",
    "Seattle Mariners":"Mariners","Houston Astros":"Astros","Texas Rangers":"Rangers",
    "Cleveland Guardians":"Guardians","Detroit Tigers":"Tigers","Baltimore Orioles":"Orioles",
    "Atlanta Braves":"Braves","Philadelphia Phillies":"Phillies","Washington Nationals":"Nationals",
    "Miami Marlins":"Marlins","Pittsburgh Pirates":"Pirates","St. Louis Cardinals":"Cardinals",
    "Milwaukee Brewers":"Brewers","Cincinnati Reds":"Reds","Arizona Diamondbacks":"Diamondbacks",
  };
  return map[team] || team.split(" ").pop();
}

function buildTweetBlock(picks, yWins, yLosses, yesterday) {
  const hasY = yWins + yLosses > 0;
  const yLabel = hasY ? `📊 Yesterday: ${yWins}-${yLosses} ${yWins>yLosses?"✅":yWins<yLosses?"❌":"➖"}\n\n` : "";
  const ic = { CLEAN:"🔥", BET:"✅" };
  const fmtO = o => o==null?"":o>0?` (+${o})`:`(${o})`;
  const today = new Date().toLocaleDateString("en-US",{timeZone:"America/Chicago",weekday:"short",month:"short",day:"numeric"});

  const thread = [
    `${yLabel}Today's top ${picks.length} MLB pick${picks.length>1?"s":""} — ${today} 🧵👇\n\n${APP_URL}`,
    ...picks.map((p,i) => {
      const f=p.filter||{}, b=p.breakdown||{};
      const odds=p.pick===p.homeTeam?p.homeOdds:p.awayOdds;
      const stat=(b.what_decides||b.preview||"").slice(0,120);
      return [
        `${i+1}/${picks.length} ${ic[f.verdict]||"👀"} ${shortName(p.awayTeam)} @ ${shortName(p.homeTeam)}`,
        `Take: ${shortName(p.pick)}${fmtO(odds)} | +${p.edge?.toFixed(1)}% edge`,
        f.verdict==="CLEAN"?"CLEAN — all conditions ✅":"BET",
        stat?`\n${stat}`:"",
        `\n${APP_URL}`,
      ].filter(Boolean).join("\n");
    }),
  ];

  const rows = thread.map((t,i) =>
    `<tr><td style="padding:10px 0;border-bottom:1px solid #111;vertical-align:top;">
      <div style="font-size:10px;color:#333;letter-spacing:1.5px;margin-bottom:6px;">${i===0?"HOOK":"REPLY "+i}</div>
      <pre style="font-family:monospace;font-size:12px;color:#666;white-space:pre-wrap;line-height:1.6;margin:0;">${t}</pre>
    </td></tr>`
  ).join("");

  return `
    <div style="margin:24px 0;border-top:1px solid #111;padding-top:20px;">
      <div style="font-size:11px;color:#333;letter-spacing:2px;margin-bottom:12px;">YOUR TWEET THREAD TODAY</div>
      <div style="font-size:11px;color:#222;margin-bottom:12px;line-height:1.6;">Copy each tweet in order. Post the hook first, then reply with each pick. X app: tap Reply under your own tweet.</div>
      <table style="width:100%;border-collapse:collapse;">${rows}</table>
      <div style="margin-top:12px;text-align:center;">
        <a href="${APP_URL}/admin/tweet" style="font-size:12px;color:#00FF87;text-decoration:none;">→ Open tweet admin page</a>
      </div>
    </div>`;
}

function buildEmailHtml(pick, topPicks, yWins, yLosses, yesterday) {
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

    ${topPicks?.length ? buildTweetBlock(topPicks, yWins, yLosses, yesterday) : ""}

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
  const resend   = new Resend(process.env.RESEND_API_KEY);

  // CT-based today/yesterday
  const ctParts = (d) => {
    const p = new Intl.DateTimeFormat("en-US",{timeZone:"America/Chicago",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(d);
    return `${p.find(x=>x.type==="year").value}-${p.find(x=>x.type==="month").value}-${p.find(x=>x.type==="day").value}`;
  };
  const today     = ctParts(new Date());
  const yesterday = ctParts(new Date(Date.now() - 86400000));

  // Idempotency guard — a retried/duplicated cron invocation must not re-send
  // to the whole list a second time (can't un-send an email once it's out).
  const { data: alreadySent } = await supabase
    .from("picks_cache").select("date").eq("date", `__email_${today}__`).single();
  if (alreadySent) return Response.json({ sent: 0, reason: "already sent today" });

  // Today's picks
  const { data: cached } = await supabase.from("picks_cache").select("picks").eq("date", today).single();
  const allPicks = cached?.picks || [];
  const pick     = allPicks.find(p => p.filter?.verdict === "CLEAN") || allPicks.find(p => p.isBet) || null;
  const topPicks = allPicks.filter(p=>p.isBet)
    .sort((a,b)=>(b.filter?.verdict==="CLEAN"?1000:b.filter?.confidence||0)-(a.filter?.verdict==="CLEAN"?1000:a.filter?.confidence||0))
    .slice(0,3);

  if (!pick) return Response.json({ sent: 0, reason: "no pick today" });

  // Yesterday's record
  const { data: yPicks } = await supabase.from("model_picks").select("result,is_bet")
    .eq("date", yesterday).eq("is_bet", true).in("result",["win","loss","push"]);
  const yWins   = (yPicks||[]).filter(p=>p.result==="win").length;
  const yLosses = (yPicks||[]).filter(p=>p.result==="loss").length;

  // Get all subscribers
  const { data: subscribers } = await supabase.from("email_list").select("email");
  if (!subscribers?.length) return Response.json({ sent: 0, reason: "no subscribers" });

  const html    = buildEmailHtml(pick, topPicks, yWins, yLosses, yesterday);
  const subject = `Today's Pick: ${pick.awayTeam} @ ${pick.homeTeam} — Take ${pick.pick}`;

  const fromAddr = process.env.RESEND_FROM || "T|T Picks <onboarding@resend.dev>";

  // Send in batches of 50 (Resend rate limit)
  let sent = 0, failed = 0;
  const errors = [];
  const BATCH = 50;
  for (let i = 0; i < subscribers.length; i += BATCH) {
    const batch = subscribers.slice(i, i + BATCH);
    const results = await Promise.all(batch.map(({ email }) => {
      const token = createHmac("sha256", process.env.SUPABASE_SERVICE_ROLE_KEY || "").update(email).digest("hex");
      return resend.emails.send({
        from:    fromAddr,
        to:      email,
        subject,
        html:    html.replace("{{email}}", encodeURIComponent(email)).replace("{{token}}", token),
      }).then(() => ({ ok: true })).catch(err => ({ ok: false, err: err.message }));
    }));
    for (const r of results) {
      if (r.ok) sent++;
      else { failed++; if (errors.length < 3) errors.push(r.err); }
    }
  }

  if (sent > 0) {
    await supabase.from("picks_cache").upsert(
      { date: `__email_${today}__`, picks: [], generated_at: new Date().toISOString() },
      { onConflict: "date" }
    );
  }

  return Response.json({ sent, failed, errors, today, pick: `${pick.awayTeam} @ ${pick.homeTeam}` });
}
