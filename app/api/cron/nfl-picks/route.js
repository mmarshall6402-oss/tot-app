// app/api/cron/nfl-picks/route.js
// No scheduled cron yet in Phase 1 (explicit fast-follow) — this is the
// CRON_SECRET-gated generation endpoint that app/api/admin/regen/route.js
// forwards to for sport=nfl, so picks can be force-generated manually while
// the model is being validated.
import { createClient } from "@supabase/supabase-js";
import { fetchNFLOdds } from "../../../../lib/nfl-odds.js";
import { buildNFLPicksForGames } from "../../../../lib/nfl-picks.js";
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
    const dateParam = new URL(request.url).searchParams.get("date");

    const games = await fetchNFLOdds();
    if (!games.length) {
      return Response.json({ generated: [], notice: "no NFL games/odds available" });
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

      // Track each pick as its own row so nfl-resolve can settle results and
      // update nfl_team_elo — without this, results/ELO have nothing to write to.
      const { data: alreadyTracked } = await supabase
        .from("nfl_model_picks").select("id").eq("date", date).limit(1);
      if (!alreadyTracked?.length) {
        const rows = picks.map(p => ({
          date, home_team: p.homeTeam, away_team: p.awayTeam,
          pick: p.pick, odds: p.homeOdds != null && p.awayOdds != null
            ? (p.pick === p.homeTeam ? p.homeOdds : p.awayOdds) : null,
          edge: p.edge ?? null, tier: p.tier?.level || "Low", is_bet: !!p.isBet,
        }));
        await supabase.from("nfl_model_picks").insert(rows);
      }

      generated.push({ date, count: picks.length });
    }

    return Response.json({ generated });
  } catch (e) {
    console.error("[cron/nfl-picks] error:", e);
    return Response.json({ error: e.message }, { status: 500 });
  }
}
