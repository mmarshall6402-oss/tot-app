// Live "today" NFL W/L record — mirrors app/api/daily-record's role for MLB
// (which live-resolves any picks the nightly cron hasn't graded yet against
// the MLB Stats API). NFL grades once a day via app/api/cron/nfl-resolve, so
// on a game day the record can otherwise sit at 0-0 for hours after games
// finish. This route re-uses that cron's own grading helpers (read-only, no
// DB writes) so results shown here always match what the cron would persist.

import { createClient } from "@supabase/supabase-js";
import { getNFLGamesForDate } from "../../../../lib/nfl-stats.js";
import { findNFLGameMatch, gradeNFLPick } from "../../../../lib/nfl-picks.js";

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function GET() {
  try {
    const ctParts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(new Date());
    const today = `${ctParts.find(p => p.type === "year").value}-${ctParts.find(p => p.type === "month").value}-${ctParts.find(p => p.type === "day").value}`;

    const supabase = getSupabase();
    const { data: rows } = await supabase
      .from("nfl_model_picks")
      .select("home_team, away_team, pick, market_type, line, result")
      .eq("date", today)
      .eq("is_bet", true)
      .eq("season_type", "regular");

    if (!rows?.length) return Response.json({ wins: 0, losses: 0, pushes: 0, pending: 0 });

    let wins = 0, losses = 0, pushes = 0, pending = 0;
    const alreadyGraded = rows.filter(r => ["win", "loss", "push"].includes(r.result));
    const toResolve = rows.filter(r => r.result === "pending");

    for (const r of alreadyGraded) {
      if (r.result === "win") wins++;
      else if (r.result === "loss") losses++;
      else pushes++;
    }

    if (toResolve.length) {
      const games = await getNFLGamesForDate(today);
      for (const pick of toResolve) {
        const g = findNFLGameMatch(pick, games);
        if (!g || !g.completed || g.homeScore == null || g.awayScore == null) { pending++; continue; }
        const result = gradeNFLPick(pick, g.homeScore, g.awayScore);
        if (result === "win") wins++;
        else if (result === "loss") losses++;
        else pushes++;
      }
    }

    return Response.json({ wins, losses, pushes, pending });
  } catch (e) {
    console.error("[nfl/today-record] fatal:", e);
    return Response.json({ error: e?.message || e?.name || "unknown error" }, { status: 500 });
  }
}
