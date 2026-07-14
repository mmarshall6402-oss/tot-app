// app/api/props/route.js
// Client-facing read path for Trending Picks (MLB player props). Serves from
// prop_picks_cache (written by app/api/cron/props/route.js), then refreshes
// live to fill in batter home-run picks for games whose lineups have posted
// since the cron ran — mirroring how /api/picks refreshes lineup-dependent
// moneyline signals on read instead of waiting for the next cron cycle.
import { createClient } from "@supabase/supabase-js";
import { requirePro } from "../../../lib/auth.js";
import { fetchEventPlayerProps } from "../../../lib/odds-props.js";
import { fetchBattersForLineup } from "../../../lib/mlb-batters.js";
import { projectBatterHR } from "../../../lib/prop-probability.js";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const EDGE_FLOOR_PCT = 2;
const MAX_PICKS = 20;

function normName(s) {
  return (s || "").toLowerCase().trim().replace(/[.'-]/g, "").replace(/\s+/g, " ");
}
function matchPlayerProp(name, candidates) {
  const n = normName(name);
  if (!n) return null;
  let hit = candidates.find(c => normName(c.player) === n);
  if (hit) return hit;
  const last = n.split(" ").pop();
  hit = candidates.find(c => normName(c.player).split(" ").pop() === last);
  return hit || null;
}

export async function GET(request) {
  const { error: authError } = await requirePro(request);
  if (authError) return authError;

  const supabase = getSupabase();
  try {
    const { searchParams } = new URL(request.url);
    const ctParts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(new Date());
    const today = `${ctParts.find(p => p.type === "year").value}-${ctParts.find(p => p.type === "month").value}-${ctParts.find(p => p.type === "day").value}`;
    const dateParam = searchParams.get("date");
    if (dateParam && !/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      return Response.json({ error: "invalid date" }, { status: 400 });
    }
    const date = dateParam || today;

    const { data: cached } = await supabase
      .from("prop_picks_cache")
      .select("picks, generated_at")
      .eq("date", date)
      .single();

    let picks = cached?.picks || [];
    if (!cached) {
      return Response.json({ picks: [], cached: false, notice: "prop picks not yet generated for this date" });
    }

    // Only refresh live for today/future dates — past dates are settled.
    if (date >= today) {
      const mlbRes = await fetch(`${BASE_URL}/api/mlb?date=${date}`).then(r => r.json()).catch(() => ({ games: [] }));
      const mlbGames = mlbRes?.games || [];

      const haveHrForGame = new Set(picks.filter(p => p.marketType === "batter_hr").map(p => p.gameId));
      const eventIdByGameId = new Map(picks.filter(p => p.gameId && p.eventId).map(p => [p.gameId, p.eventId]));

      const gamesNeedingHr = mlbGames.filter(g =>
        !haveHrForGame.has(String(g.gameId)) &&
        ((g.homeLineupIds?.length) || (g.awayLineupIds?.length)) &&
        eventIdByGameId.has(String(g.gameId))
      );

      if (gamesNeedingHr.length) {
        const newPicks = [];
        await Promise.all(gamesNeedingHr.map(async (mlb) => {
          const eventId = eventIdByGameId.get(String(mlb.gameId));
          let props;
          try { props = await fetchEventPlayerProps(eventId); } catch { return; }
          const [homeBatters, awayBatters] = await Promise.all([
            fetchBattersForLineup(mlb.homeLineupIds || []),
            fetchBattersForLineup(mlb.awayLineupIds || []),
          ]);
          for (const group of [
            { batters: homeBatters, team: mlb.homeTeam, opponent: mlb.awayTeam, oppPitcher: mlb.awayPitcher },
            { batters: awayBatters, team: mlb.awayTeam, opponent: mlb.homeTeam, oppPitcher: mlb.homePitcher },
          ]) {
            for (const batter of group.batters) {
              const line = matchPlayerProp(batter.name, props.homeRuns);
              if (!line) continue;
              const proj = projectBatterHR({
                batter, pitcher: group.oppPitcher, homeTeam: mlb.homeTeam,
                yesOdds: line.yesOdds, noOdds: line.noOdds,
              });
              if (!proj) continue;
              newPicks.push({
                eventId, gameId: String(mlb.gameId), homeTeam: mlb.homeTeam, awayTeam: mlb.awayTeam,
                commenceTime: mlb.commenceTime, team: group.team, opponent: group.opponent,
                playerId: batter.id, bookmaker: line.bookmaker, ...proj,
              });
            }
          }
        }));

        if (newPicks.length) {
          picks = [...picks, ...newPicks]
            .filter(p => p.edgePct >= EDGE_FLOOR_PCT)
            .sort((a, b) => b.edgePct - a.edgePct)
            .slice(0, MAX_PICKS);
          supabase.from("prop_picks_cache")
            .upsert({ date, picks, generated_at: new Date().toISOString() }, { onConflict: "date" })
            .then(() => {}).catch(e => console.warn("[props] cache write failed:", e.message));
        }
      }
    }

    return Response.json({ picks, cached: true, generated_at: cached.generated_at });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
