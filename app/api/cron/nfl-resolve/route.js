// app/api/cron/nfl-resolve/route.js
// Manually-triggered for now (mirrors cron/nfl-picks — no scheduled cron yet
// in Phase 1). Resolves pending nfl_model_picks and updates nfl_team_elo,
// the NFL equivalent of cron/resolve/route.js. Without this, nfl_team_elo
// never gets written to and every team stays frozen at the 1500 default.

import { createClient } from "@supabase/supabase-js";
import { getEloRatings, updateEloAfterGame } from "../../../../lib/elo-db.js";
import { timingSafeEqual } from "../../../../lib/auth.js";

const ESPN_SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function ctDateStr(d = new Date()) {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(d);
  return `${p.find(x => x.type === "year").value}-${p.find(x => x.type === "month").value}-${p.find(x => x.type === "day").value}`;
}

const lastWord = s => (s || "").toLowerCase().trim().split(" ").pop();

async function fetchScoreboard(date) {
  try {
    const res = await fetch(`${ESPN_SCOREBOARD}?dates=${date.replace(/-/g, "")}`);
    if (!res.ok) return [];
    const json = await res.json();
    return json?.events || [];
  } catch { return []; }
}

function findGame(events, pick) {
  return events.find(e => {
    const comp = e.competitions?.[0];
    const home = comp?.competitors?.find(c => c.homeAway === "home")?.team?.displayName || "";
    const away = comp?.competitors?.find(c => c.homeAway === "away")?.team?.displayName || "";
    return home.toLowerCase().includes(lastWord(pick.home_team)) &&
           away.toLowerCase().includes(lastWord(pick.away_team));
  });
}

export async function GET(request) {
  const authHeader = request.headers.get("authorization")?.replace("Bearer ", "");
  if (!timingSafeEqual(authHeader, process.env.CRON_SECRET)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dateParam = new URL(request.url).searchParams.get("date");
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const date = dateParam || ctDateStr(yesterday);
  const supabase = getSupabase();

  try {
    const { data: pending } = await supabase
      .from("nfl_model_picks")
      .select("*")
      .eq("date", date)
      .eq("result", "pending");

    if (!pending?.length) {
      return Response.json({ resolved: 0, message: "No pending NFL picks", date });
    }

    const [events, eloRatings] = await Promise.all([
      fetchScoreboard(date),
      getEloRatings(supabase, "nfl_team_elo", null),
    ]);

    let currentElo = { ...eloRatings };
    let resolved = 0;
    const eloUpdatedGames = new Set();

    for (const pick of pending) {
      const game = findGame(events, pick);
      if (!game) continue;

      const comp = game.competitions?.[0];
      const status = comp?.status?.type;
      const home = comp?.competitors?.find(c => c.homeAway === "home");
      const away = comp?.competitors?.find(c => c.homeAway === "away");

      let result, homeScore = null, awayScore = null;
      if (status?.name === "STATUS_POSTPONED" || status?.name === "STATUS_CANCELED") {
        result = "push";
      } else {
        if (!status?.completed) continue;
        homeScore = home?.score != null ? parseInt(home.score, 10) : null;
        awayScore = away?.score != null ? parseInt(away.score, 10) : null;
        if (homeScore === null || awayScore === null) continue;
        if (homeScore === awayScore) result = "push";
        else if (homeScore > awayScore) result = pick.home_team === pick.pick ? "win" : "loss";
        else result = pick.away_team === pick.pick ? "win" : "loss";
      }

      await supabase.from("nfl_model_picks").update({
        result, home_score: homeScore, away_score: awayScore,
        resolved_at: new Date().toISOString(),
      }).eq("id", pick.id);

      const gameKey = `${pick.home_team}|${pick.away_team}`;
      if (!eloUpdatedGames.has(gameKey) && result !== "push") {
        currentElo = await updateEloAfterGame(
          supabase, pick.home_team, pick.away_team, homeScore > awayScore, currentElo, "nfl_team_elo"
        );
        eloUpdatedGames.add(gameKey);
      }

      resolved++;
    }

    return Response.json({ resolved, total: pending.length, date, eloUpdated: eloUpdatedGames.size });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
