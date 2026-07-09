// app/api/cron/nfl-picks/route.js
// Scheduled weekly via Vercel cron (Tuesday early morning — see vercel.json — after
// Monday Night Football wraps and the following week's lines/schedule have settled).
// Also the CRON_SECRET-gated endpoint app/api/admin/regen/route.js forwards to for
// sport=nfl, so picks can still be force-regenerated manually.
import { createClient } from "@supabase/supabase-js";
import { fetchNFLOdds } from "../../../../lib/nfl-odds.js";
import { buildNFLPicksForGames, buildNFLModelPickRows } from "../../../../lib/nfl-picks.js";
import { timingSafeEqual } from "../../../../lib/auth.js";

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function ctDateOf(iso) {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(iso));
  return `${p.find(x => x.type === "year").value}-${p.find(x => x.type === "month").value}-${p.find(x => x.type === "day").value}`;
}

export async function GET(request) {
  const authHeader = request.headers.get("authorization")?.replace("Bearer ", "").trim();
  if (!timingSafeEqual(authHeader, process.env.CRON_SECRET)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabase();
  try {
    const { searchParams } = new URL(request.url);
    const dateParam = searchParams.get("date");
    // Preseason mode lets the whole pipeline get exercised against real games before
    // the regular season starts — tagged season_type='preseason' so resolve skips
    // Elo/record updates for it (see app/api/cron/nfl-resolve, app/api/nfl/daily-record).
    const preseason = searchParams.get("preseason") === "1";
    const seasonType = preseason ? "preseason" : "regular";

    const games = await fetchNFLOdds(preseason ? "americanfootball_nfl_preseason" : "americanfootball_nfl");
    if (!games.length) {
      return Response.json({ generated: [], notice: `no NFL${preseason ? " preseason" : ""} games/odds available` });
    }

    const byDate = new Map();
    for (const g of games) {
      const d = ctDateOf(g.commenceTime);
      if (dateParam && d !== dateParam) continue;
      if (!byDate.has(d)) byDate.set(d, []);
      byDate.get(d).push(g);
    }

    if (!byDate.size) {
      return Response.json({ generated: [], notice: dateParam ? `no NFL games on ${dateParam}` : "no upcoming NFL games" });
    }

    const generated = [];
    for (const [date, dateGames] of byDate) {
      const picks = await buildNFLPicksForGames(dateGames, supabase);
      if (!picks.length) continue;
      await supabase
        .from("nfl_picks_cache")
        .upsert({ date, picks, generated_at: new Date().toISOString() }, { onConflict: "date" });

      // Only (re)seed nfl_model_picks if nothing for this date has resolved yet —
      // don't clobber picks that are already being graded (mirrors cron/picks.js's
      // existingSettled guard for MLB's model_picks table).
      const { data: existingSettled } = await supabase.from("nfl_model_picks")
        .select("id").eq("date", date).in("result", ["win", "loss", "push"]).limit(1);
      if (!existingSettled?.length) {
        const rows = buildNFLModelPickRows(picks, date, seasonType);
        if (rows.length) {
          await supabase.from("nfl_model_picks").delete().eq("date", date);
          const { error: insErr } = await supabase.from("nfl_model_picks").insert(rows);
          if (insErr) console.warn("[cron/nfl-picks] nfl_model_picks insert failed:", insErr.message);
        }
      }

      generated.push({ date, count: picks.length });
    }

    return Response.json({ generated });
  } catch (e) {
    console.error("[cron/nfl-picks] error:", e);
    return Response.json({ error: e.message }, { status: 500 });
  }
}
