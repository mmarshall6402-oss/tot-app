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
import { logError } from "../../../lib/error-log.js";

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
      .select("picks, all_picks, generated_at")
      .eq("date", date)
      .single();

    let picks = cached?.picks || [];
    let allProps = cached?.all_picks || [];
    if (!cached) {
      return Response.json({ picks: [], allProps: [], cached: false, notice: "prop picks not yet generated for this date" });
    }

    // Only refresh live for today/future dates — past dates are settled.
    if (date >= today) {
      const mlbRes = await fetch(`${BASE_URL}/api/mlb?date=${date}`).then(r => r.json()).catch(() => ({ games: [] }));
      const mlbGames = mlbRes?.games || [];

      // Checked against allProps (the full set), not just picks (the
      // edge-filtered trending subset) — a game whose HR props were already
      // computed by cron but didn't clear the edge floor shouldn't be
      // treated as "needing" a live recompute.
      const haveHrForGame = new Set(allProps.filter(p => p.marketType === "batter_hr").map(p => p.gameId));
      const eventIdByGameId = new Map(allProps.filter(p => p.gameId && p.eventId).map(p => [p.gameId, p.eventId]));

      const gamesNeedingHr = mlbGames.filter(g =>
        !haveHrForGame.has(String(g.gameId)) &&
        ((g.homeLineupIds?.length) || (g.awayLineupIds?.length)) &&
        eventIdByGameId.has(String(g.gameId))
      );

      if (gamesNeedingHr.length) {
        const newPicks = [];
        await Promise.all(gamesNeedingHr.map(async (mlb) => {
          const eventId = eventIdByGameId.get(String(mlb.gameId));

          // Claim this event before firing a live The Odds API call — cold
          // starts mean lib/odds-props.js's in-memory cache doesn't dedupe
          // across serverless instances, so without this every concurrent
          // request for a game whose lineup just posted fires its own live
          // fetch. 15s TTL: long enough to cover a normal fetch, short
          // enough that a claimant that died mid-request (no chance to
          // release) doesn't block retries for long.
          let claimed = true;
          try {
            const { data } = await supabase.rpc("claim_prop_fetch", { p_event_id: eventId, p_ttl_seconds: 15 });
            claimed = data !== false;
          } catch (e) {
            // Fail open (proceed as if claimed) so a DB hiccup or the
            // migration not being run yet degrades to pre-lock behavior
            // instead of breaking props — but log it. A silently-failing
            // claim looks identical to "fix applied" while doing nothing.
            logError("rate-limit-guard", e.message, { route: "/api/props:claim_prop_fetch" });
          }

          if (!claimed) {
            // Lost the claim — another instance is already fetching this
            // event. Wait briefly and re-read the cache once instead of
            // giving up immediately: for a game's first fetch of the day
            // there's nothing to fall back to yet, so without this the
            // loser would render that game's HR props as blank instead of
            // picking up the winner's result, which typically lands well
            // within the 15s window.
            await new Promise(r => setTimeout(r, 1500));
            const { data: refreshed } = await supabase
              .from("prop_picks_cache")
              .select("all_picks")
              .eq("date", date)
              .single();
            const alreadyFetched = (refreshed?.all_picks || [])
              .filter(p => p.marketType === "batter_hr" && p.gameId === String(mlb.gameId));
            if (alreadyFetched.length) newPicks.push(...alreadyFetched);
            return;
          }

          let props;
          try {
            props = await fetchEventPlayerProps(eventId);
          } catch (e) {
            // Release immediately on failure — otherwise a single TOA
            // error costs a full claim window of missing props for this
            // event, right when lineup-posting traffic is highest.
            try { await supabase.from("prop_fetch_claims").delete().eq("event_id", eventId); } catch { /* best effort */ }
            return;
          }
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
          // allProps gets every newly computed pick, unfiltered — mirrors
          // cron's all_picks (no edge floor, no cap) so late-posted lineups
          // still show up in the Props tab's "All Props" list.
          allProps = [...allProps, ...newPicks];
          picks = [...picks, ...newPicks]
            .filter(p => p.edgePct >= EDGE_FLOOR_PCT)
            .sort((a, b) => b.edgePct - a.edgePct)
            .slice(0, MAX_PICKS);
          supabase.from("prop_picks_cache")
            .upsert({ date, picks, all_picks: allProps, generated_at: new Date().toISOString() }, { onConflict: "date" })
            .then(() => {}).catch(e => console.warn("[props] cache write failed:", e.message));
        }
      }
    }

    return Response.json({ picks, allProps, cached: true, generated_at: cached.generated_at });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
