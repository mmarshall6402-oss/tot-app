// app/api/cron/props/route.js
// Runs at 3:15 PM UTC daily, 15 min after /api/cron/picks so /api/mlb is
// already warm. Generates MLB player prop picks (pitcher strikeouts, batter
// anytime home run) against real sportsbook lines and writes them to
// Supabase cache. On-demand /api/props serves from this cache.
import { createClient } from "@supabase/supabase-js";
import { fetchMLBOdds } from "../../../../lib/odds.js";
import { fetchAllPlayerProps } from "../../../../lib/odds-props.js";
import { fetchBattersForLineup } from "../../../../lib/mlb-batters.js";
import { projectPitcherKs, projectBatterHR } from "../../../../lib/prop-probability.js";
import { timingSafeEqual } from "../../../../lib/auth.js";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const EDGE_FLOOR_PCT = 2;
const MAX_PICKS = 20;

function normName(s) {
  return (s || "").toLowerCase().trim().replace(/[.'-]/g, "").replace(/\s+/g, " ");
}

// Match a player name (MLB Stats API fullName) against Odds API prop outcomes
// (keyed by `description`). Exact normalized match first, last-name fallback
// second — books occasionally format suffixes ("Jr.", "II") differently.
function matchPlayerProp(name, candidates) {
  const n = normName(name);
  if (!n) return null;
  let hit = candidates.find(c => normName(c.player) === n);
  if (hit) return hit;
  const last = n.split(" ").pop();
  hit = candidates.find(c => normName(c.player).split(" ").pop() === last);
  return hit || null;
}

function matchGame(oddsGame, mlbGames) {
  const norm = s => (s || "").toLowerCase().trim();
  const lastWord = s => norm(s).split(" ").pop();
  const timeClose = (t1, t2) => {
    if (!t1 || !t2) return true;
    return Math.abs(new Date(t1) - new Date(t2)) < 12 * 3_600_000;
  };
  let match = mlbGames.find(g =>
    norm(g.homeTeam) === norm(oddsGame.homeTeam) &&
    norm(g.awayTeam) === norm(oddsGame.awayTeam) &&
    timeClose(g.commenceTime, oddsGame.commenceTime)
  );
  if (match) return match;
  return mlbGames.find(g =>
    norm(g.homeTeam).includes(lastWord(oddsGame.homeTeam)) &&
    norm(g.awayTeam).includes(lastWord(oddsGame.awayTeam)) &&
    timeClose(g.commenceTime, oddsGame.commenceTime)
  ) || null;
}

function ctDateStr(d = new Date()) {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(d);
  return `${p.find(x => x.type === "year").value}-${p.find(x => x.type === "month").value}-${p.find(x => x.type === "day").value}`;
}

async function generatePropsForDate(date, oddsGames, supabase) {
  // Player props only work off events sourced directly from The Odds API —
  // its event.id is the only id scheme the per-event props endpoint accepts.
  // SGO/ESPN-only games (no TOA line) are skipped for props purposes (v1 scope).
  const dateOdds = oddsGames.filter(g => {
    if (g.source !== "theoddsapi" || !g.commenceTime) return false;
    const t = new Date(g.commenceTime);
    const utcDate = t.toISOString().split("T")[0];
    return utcDate === date || ctDateStr(t) === date;
  });
  if (!dateOdds.length) return { date, count: 0, reason: "no theoddsapi games for date" };

  const mlbRes = await fetch(`${BASE_URL}/api/mlb?date=${date}`).then(r => r.json()).catch(() => ({}));
  const mlbGames = mlbRes?.games || [];
  if (!mlbGames.length) return { date, count: 0, reason: "no MLB schedule for date" };

  const allProps = await fetchAllPlayerProps(dateOdds.map(g => g.id));
  const propsByEvent = new Map(allProps.map(p => [p.eventId, p]));

  const picks = [];
  await Promise.all(dateOdds.map(async (oddsGame) => {
    const props = propsByEvent.get(oddsGame.id);
    if (!props) return;
    const mlb = matchGame(oddsGame, mlbGames);
    if (!mlb) return;

    const base = {
      eventId: oddsGame.id,
      gameId: String(mlb.gameId),
      homeTeam: mlb.homeTeam,
      awayTeam: mlb.awayTeam,
      commenceTime: mlb.commenceTime,
    };

    // Pitcher strikeouts — every game with a posted probable pitcher and a
    // matching sportsbook line, no lineup dependency.
    for (const side of [
      { pitcher: mlb.homePitcher, team: mlb.homeTeam, opponent: mlb.awayTeam },
      { pitcher: mlb.awayPitcher, team: mlb.awayTeam, opponent: mlb.homeTeam },
    ]) {
      if (!side.pitcher) continue;
      const line = matchPlayerProp(side.pitcher.name, props.strikeouts);
      if (!line) continue;
      const proj = projectPitcherKs({
        pitcher: side.pitcher, oppTeamKPct: null,
        line: line.line, overOdds: line.overOdds, underOdds: line.underOdds,
      });
      if (!proj) continue;
      picks.push({ ...base, ...proj, team: side.team, opponent: side.opponent, playerId: side.pitcher.id, bookmaker: line.bookmaker });
    }

    // Batter home runs — only once a lineup is posted (~90 min pre-game).
    // Most games at cron time won't have one yet; that's expected, same as
    // how homeLineupSavant behaves null-until-posted in the moneyline pipeline.
    const homeIds = mlb.homeLineupIds || [];
    const awayIds = mlb.awayLineupIds || [];
    if (!homeIds.length && !awayIds.length) return;

    const [homeBatters, awayBatters] = await Promise.all([
      fetchBattersForLineup(homeIds),
      fetchBattersForLineup(awayIds),
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
        picks.push({ ...base, ...proj, team: group.team, opponent: group.opponent, playerId: batter.id, bookmaker: line.bookmaker });
      }
    }
  }));

  const trending = picks
    .filter(p => p.edgePct >= EDGE_FLOOR_PCT)
    .sort((a, b) => b.edgePct - a.edgePct)
    .slice(0, MAX_PICKS);

  await supabase.from("prop_picks_cache")
    .upsert({ date, picks: trending, generated_at: new Date().toISOString() }, { onConflict: "date" });

  const { data: existingSettled } = await supabase.from("prop_model_picks")
    .select("id").eq("date", date).in("result", ["win", "loss"]).limit(1);
  if (!existingSettled?.length && trending.length) {
    const rows = trending.map(p => ({
      date, event_id: p.eventId, game_id: p.gameId, market_type: p.marketType,
      player_id: p.playerId ?? null, player_name: p.player, team: p.team, opponent: p.opponent,
      home_team: p.homeTeam, away_team: p.awayTeam, line: p.line, pick: p.pick, odds: p.odds,
      model_prob: p.modelProb, market_prob: p.marketProb, edge: p.edgePct, confidence: p.confidencePct,
      bookmaker: p.bookmaker, result: "pending",
      features: { lambda: p.lambda },
    }));
    await supabase.from("prop_model_picks").delete().eq("date", date);
    const { error: insErr } = await supabase.from("prop_model_picks").insert(rows);
    if (insErr) {
      console.warn("[cron/props] insert failed, retrying without features:", insErr.message);
      const rowsNoFeatures = rows.map(({ features: _f, ...r }) => r);
      await supabase.from("prop_model_picks").insert(rowsNoFeatures);
    }
  }

  return { date, count: trending.length };
}

export async function GET(request) {
  const authHeader = request.headers.get("authorization")?.replace("Bearer ", "");
  if (!timingSafeEqual(authHeader, process.env.CRON_SECRET)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const today = ctDateStr();
    const tomorrow = ctDateStr(new Date(Date.now() + 86400000));

    const oddsGames = await fetchMLBOdds();
    const supabase = getSupabase();

    const todayResult = await generatePropsForDate(today, oddsGames, supabase);
    const tomorrowResult = await generatePropsForDate(tomorrow, oddsGames, supabase);

    return Response.json({ today: todayResult, tomorrow: tomorrowResult });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
