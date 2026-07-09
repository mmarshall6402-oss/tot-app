// Runs at 10:15 AM CT (3:15 PM UTC) daily — after the picks cron at 10 AM CT.
// Posts today's top 3 picks as a Twitter thread + yesterday's record at the top.
import { TwitterApi } from "twitter-api-v2";
import { createClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "../../../../lib/auth.js";

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const APP_URL = "https://tot-app.vercel.app";

function fmtOdds(o) {
  if (o == null) return "";
  return o > 0 ? ` (+${o})` : ` (${o})`;
}

function shortName(team) {
  // Abbreviate long team names to keep tweets tight
  const map = {
    "Oakland Athletics": "Athletics", "Los Angeles Angels": "Angels",
    "Los Angeles Dodgers": "Dodgers", "New York Yankees": "Yankees",
    "New York Mets": "Mets", "Chicago White Sox": "White Sox",
    "Chicago Cubs": "Cubs", "Boston Red Sox": "Red Sox",
    "Tampa Bay Rays": "Rays", "San Francisco Giants": "Giants",
    "San Diego Padres": "Padres", "Kansas City Royals": "Royals",
    "Toronto Blue Jays": "Blue Jays", "Colorado Rockies": "Rockies",
    "Minnesota Twins": "Twins", "Seattle Mariners": "Mariners",
    "Houston Astros": "Astros", "Texas Rangers": "Rangers",
    "Cleveland Guardians": "Guardians", "Detroit Tigers": "Tigers",
    "Baltimore Orioles": "Orioles", "Atlanta Braves": "Braves",
    "Philadelphia Phillies": "Phillies", "Washington Nationals": "Nationals",
    "Miami Marlins": "Marlins", "Pittsburgh Pirates": "Pirates",
    "St. Louis Cardinals": "Cardinals", "Milwaukee Brewers": "Brewers",
    "Cincinnati Reds": "Reds", "Arizona Diamondbacks": "Diamondbacks",
  };
  return map[team] || team.split(" ").pop();
}

function etDate(offset = 0) {
  const d = new Date(Date.now() + offset * 86400000);
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(d);
  return `${p.find(x => x.type === "year").value}-${p.find(x => x.type === "month").value}-${p.find(x => x.type === "day").value}`;
}

function fmtDateLabel(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export async function GET(request) {
  const authHeader = request.headers.get("authorization")?.replace("Bearer ", "");
  if (!timingSafeEqual(authHeader, process.env.CRON_SECRET)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const missingEnv = ["TWITTER_API_KEY", "TWITTER_API_SECRET", "TWITTER_ACCESS_TOKEN", "TWITTER_ACCESS_SECRET"]
    .filter(k => !process.env[k]);
  if (missingEnv.length) {
    return Response.json({ error: `Missing env vars: ${missingEnv.join(", ")}` }, { status: 500 });
  }

  const supabase = getSupabase();
  const today     = etDate(0);
  const yesterday = etDate(-1);

  // Idempotency guard — a retried/duplicated cron invocation must not post
  // the whole thread a second time to the live account.
  const { data: alreadyTweeted } = await supabase
    .from("picks_cache").select("date").eq("date", `__tweet_${today}__`).single();
  if (alreadyTweeted) {
    return Response.json({ skipped: true, reason: "already tweeted today" });
  }

  try {
    // ── Fetch yesterday's results ────────────────────────────────────────────
    const { data: yPicks } = await supabase
      .from("model_picks")
      .select("result, is_bet")
      .eq("date", yesterday)
      .eq("is_bet", true)
      .in("result", ["win", "loss", "push"]);

    const yWins   = (yPicks || []).filter(p => p.result === "win").length;
    const yLosses = (yPicks || []).filter(p => p.result === "loss").length;
    const hasYesterday = yWins + yLosses > 0;

    // ── Fetch today's picks ──────────────────────────────────────────────────
    const { data: cached } = await supabase
      .from("picks_cache")
      .select("picks")
      .eq("date", today)
      .single();

    const allPicks = cached?.picks || [];
    // Top picks: CLEAN first, then BET, sorted by confidence
    const top = allPicks
      .filter(p => p.isBet)
      .sort((a, b) => {
        const score = p => p.filter?.verdict === "CLEAN" ? 1000 : p.filter?.confidence || 0;
        return score(b) - score(a);
      })
      .slice(0, 3);

    if (!top.length) {
      return Response.json({ skipped: true, reason: "no BET picks today" });
    }

    // ── Build tweet thread ───────────────────────────────────────────────────
    const emoji = { CLEAN: "🔥", BET: "✅", default: "👀" };

    // Tweet 1: hook + yesterday record
    const yLine = hasYesterday
      ? `📊 Yesterday (${fmtDateLabel(yesterday)}): ${yWins}-${yLosses} ${yWins > yLosses ? "✅" : yWins < yLosses ? "❌" : "➖"}\n\n`
      : "";
    const tweet1 = `${yLine}Today's top ${top.length} MLB pick${top.length > 1 ? "s" : ""} — ${fmtDateLabel(today)} 🧵👇\n\n${APP_URL}`;

    // Tweets 2-4: one per pick
    const pickTweets = top.map((pick, i) => {
      const f       = pick.filter || {};
      const b       = pick.breakdown || {};
      const odds    = pick.pick === pick.homeTeam ? pick.homeOdds : pick.awayOdds;
      const ic      = emoji[f.verdict] || emoji.default;
      const verdict = f.verdict === "CLEAN" ? "CLEAN — all conditions ✅" : f.verdict || "BET";
      const home    = shortName(pick.homeTeam);
      const away    = shortName(pick.awayTeam);
      const preview = b.what_decides
        ? b.what_decides.slice(0, 120)
        : (b.preview || "").slice(0, 120);

      return [
        `${i + 1}/${top.length} ${ic} ${away} @ ${home}`,
        `Take: ${shortName(pick.pick)}${fmtOdds(odds)} | +${pick.edge?.toFixed(1)}% edge`,
        verdict,
        preview ? `\n${preview}` : "",
        `\n${APP_URL}`,
      ].filter(Boolean).join("\n");
    });

    // ── Post thread ──────────────────────────────────────────────────────────
    const client = new TwitterApi({
      appKey:       process.env.TWITTER_API_KEY,
      appSecret:    process.env.TWITTER_API_SECRET,
      accessToken:  process.env.TWITTER_ACCESS_TOKEN,
      accessSecret: process.env.TWITTER_ACCESS_SECRET,
    }).readWrite;

    let replyToId = null;
    const postedIds = [];

    for (const text of [tweet1, ...pickTweets]) {
      const payload = replyToId
        ? { text, reply: { in_reply_to_tweet_id: replyToId } }
        : { text };
      const { data } = await client.v2.tweet(payload);
      replyToId = data.id;
      postedIds.push(data.id);
    }

    // Store first tweet ID so we can link back tomorrow
    await supabase.from("picks_cache").upsert(
      { date: `__tweet_${today}__`, picks: [{ tweetId: postedIds[0] }], generated_at: new Date().toISOString() },
      { onConflict: "date" }
    );

    return Response.json({ posted: postedIds.length, tweetIds: postedIds, date: today });
  } catch (e) {
    console.error("[cron/tweet] failed:", e?.message, e?.data || e?.errors || "");
    return Response.json({
      error: e?.message || "unknown error",
      details: e?.data || e?.errors || undefined,
    }, { status: 500 });
  }
}
