// app/api/cron/snapshot/route.js
// Runs at 23:00 UTC (~6 PM CT) daily — captures pre-game closing odds for CLV tracking.
// Most MLB evening games start ~7-8 PM CT, so this is ~1-2 hours before first pitch.
// Day games (1 PM CT) will already be in progress, but those are a minority.

import { createClient } from "@supabase/supabase-js";
import { fetchMLBOdds } from "../../../../lib/odds.js";
import { americanToDecimal, decimalToImplied, removeVig } from "../../../../lib/edge.js";
import { timingSafeEqual } from "../../../../lib/auth.js";

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function ctDateStr(d = new Date()) {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(d);
  return `${p.find(x=>x.type==="year").value}-${p.find(x=>x.type==="month").value}-${p.find(x=>x.type==="day").value}`;
}

const normLast = s => (s || "").toLowerCase().split(" ").pop();

function fairImplied(odds, oppOdds) {
  if (!odds || !oppOdds) return null;
  const impl  = decimalToImplied(americanToDecimal(odds));
  const oImpl = decimalToImplied(americanToDecimal(oppOdds));
  const { fairHome } = removeVig(impl, oImpl);
  return fairHome;
}

export async function GET(request) {
  const authHeader = request.headers.get("authorization")?.replace("Bearer ", "");
  if (!timingSafeEqual(authHeader, process.env.CRON_SECRET)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = ctDateStr();
  const supabase = getSupabase();

  try {
    // Fetch today's pending (unresolved) picks that have recorded opening odds
    const { data: picks } = await supabase
      .from("model_picks")
      .select("id, home_team, away_team, pick, features")
      .eq("date", today)
      .eq("result", "pending");

    if (!picks?.length) {
      return Response.json({ snapshotted: 0, message: "No pending picks for today", date: today });
    }

    // Fetch current live odds — these are the pre-game closing line approximation.
    // Retry up to 3 times with exponential backoff to handle transient API failures.
    let liveOdds = [];
    for (let attempt = 0; attempt < 3 && !liveOdds.length; attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, 2000 * attempt));
      try {
        liveOdds = await fetchMLBOdds();
      } catch (e) {
        console.warn(`[snapshot] odds fetch attempt ${attempt + 1} failed:`, e.message);
      }
    }

    if (!liveOdds.length) {
      return Response.json({ snapshotted: 0, message: "No live odds available after 3 attempts", date: today });
    }

    let snapshotted = 0;
    for (const pick of picks) {
      const game = liveOdds.find(g =>
        normLast(g.homeTeam) === normLast(pick.home_team) &&
        normLast(g.awayTeam) === normLast(pick.away_team)
      );
      if (!game?.homeOdds || !game?.awayOdds) continue;

      // Skip games that have already started (odds APIs drop in-game lines)
      if (game.commenceTime && new Date(game.commenceTime) <= new Date()) continue;

      const closeHomeFair = fairImplied(game.homeOdds, game.awayOdds);
      const closeAwayFair = fairImplied(game.awayOdds, game.homeOdds);

      const existingFeatures = pick.features || {};
      const openHomeOdds = existingFeatures.open_home_odds ?? null;
      const openAwayOdds = existingFeatures.open_away_odds ?? null;

      // CLV = closing_implied_for_pick - open_implied_for_pick
      // Positive CLV = closing line moved to agree with pick (market validated the edge)
      const pickIsHome = pick.pick === pick.home_team;
      let clv = null;
      if (openHomeOdds && openAwayOdds && closeHomeFair != null && closeAwayFair != null) {
        const openHomeFair = fairImplied(openHomeOdds, openAwayOdds);
        const openAwayFair = fairImplied(openAwayOdds, openHomeOdds);
        const openPickFair  = pickIsHome ? openHomeFair  : openAwayFair;
        const closePickFair = pickIsHome ? closeHomeFair : closeAwayFair;
        if (openPickFair != null) {
          clv = parseFloat(((closePickFair - openPickFair) * 100).toFixed(2));
        }
      }

      const updatedFeatures = {
        ...existingFeatures,
        close_home_odds: game.homeOdds,
        close_away_odds: game.awayOdds,
        close_home_fair: closeHomeFair != null ? parseFloat(closeHomeFair.toFixed(4)) : null,
        close_away_fair: closeAwayFair != null ? parseFloat(closeAwayFair.toFixed(4)) : null,
        ...(clv !== null ? { clv } : {}),
      };

      const { error } = await supabase
        .from("model_picks")
        .update({ features: updatedFeatures })
        .eq("id", pick.id);

      if (!error) snapshotted++;
      else console.warn("[snapshot] update failed for pick", pick.id, ":", error.message);
    }

    return Response.json({ snapshotted, total: picks.length, date: today });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
