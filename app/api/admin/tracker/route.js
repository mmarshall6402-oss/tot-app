// app/api/admin/tracker/route.js
// Private admin route — protected by ADMIN_KEY env var
// Handles: snapshotting picks, resolving results, fetching stats

import { createClient } from "@supabase/supabase-js";
import { requireAuth } from "../../../../lib/auth.js";

const MLB_API = "https://statsapi.mlb.com/api/v1";

// Create client lazily — env vars not available at build time
const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkAuth(request) {
  const { user } = await requireAuth(request);
  if (!user) return false;
  const admins = (process.env.NEXT_PUBLIC_ADMIN_EMAILS || process.env.NEXT_PUBLIC_ADMIN_EMAIL || "")
    .split(",").map(e => e.trim().toLowerCase()).filter(Boolean);
  return admins.includes(user.email?.toLowerCase());
}

// ─────────────────────────────────────────────
// GET: fetch tracker stats + recent picks
// ─────────────────────────────────────────────
export async function GET(request) {
  if (!await checkAuth(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action") || "stats";
  const days   = parseInt(searchParams.get("days") || "30");

  if (action === "stats") {
    const since = new Date();
    since.setDate(since.getDate() - days);
    const sinceStr = since.toISOString().split("T")[0];

    // CT date for picks_cache lookup
    const ctParts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(new Date());
    const today = `${ctParts.find(x=>x.type==="year").value}-${ctParts.find(x=>x.type==="month").value}-${ctParts.find(x=>x.type==="day").value}`;

    const sb = getSupabase();
    const [tierRes, recentRes, allTimeRes, cacheRes, historicalCacheRes, emailRes, subRes] = await Promise.all([
      sb.from("model_tier_stats").select("*"),
      sb.from("model_picks").select("*").gte("date", sinceStr).order("date", { ascending: false }).order("edge", { ascending: false }).limit(5000),
      sb.from("model_picks").select("result").eq("is_bet", true),
      sb.from("picks_cache").select("picks").eq("date", today).single(),
      sb.from("picks_cache").select("date, picks").gte("date", sinceStr).neq("date", "__odds__"),
      sb.from("email_list").select("id", { count: "exact", head: true }),
      sb.from("subscriptions").select("id", { count: "exact", head: true }).eq("status", "active"),
    ]);

    // Bet vs. pass volume per day — how many games the model actually took a
    // position on vs. sat out, alongside the win/loss record below.
    const dailyVolume = {};
    for (const row of historicalCacheRes.data || []) {
      if (!Array.isArray(row.picks)) continue;
      const bets = row.picks.filter(p => p.isBet).length;
      dailyVolume[row.date] = { bets, passed: row.picks.length - bets, total: row.picks.length };
    }

    // Overall stats (last N days)
    const picks   = recentRes.data || [];
    const settled = picks.filter(p => ["win","loss"].includes(p.result));
    const wins    = settled.filter(p => p.result === "win").length;
    const losses  = settled.filter(p => p.result === "loss").length;
    const winPct  = settled.length > 0 ? (wins / settled.length * 100).toFixed(1) : null;
    const avgEdge = picks.length > 0 ? (picks.reduce((s,p) => s + (p.edge||0), 0) / picks.length).toFixed(2) : null;
    const roi     = settled.length > 0 ? ((wins * 90.9 - losses * 100) / settled.length).toFixed(1) : null;

    // Daily win/loss record, derived straight from model_picks rather than
    // the model_daily_stats cache — that table is only upserted by the
    // resolve cron when dayWins+dayLosses > 0 for that specific run, so any
    // day where resolve failed/didn't run, or every bet pushed, silently has
    // no row and vanishes from the admin view. Computing it here from the
    // actual per-pick results can't have that gap: every settled is_bet pick
    // in the fetched window counts, regardless of whether the aggregate
    // cache ever got written.
    const dailyMap = {};
    for (const p of picks) {
      if (!p.is_bet || !["win", "loss"].includes(p.result)) continue;
      if (!dailyMap[p.date]) dailyMap[p.date] = { date: p.date, wins: 0, losses: 0 };
      if (p.result === "win") dailyMap[p.date].wins++;
      else dailyMap[p.date].losses++;
    }
    const daily = Object.values(dailyMap).sort((a, b) => b.date.localeCompare(a.date));

    // All-time record — is_bet=true only (query above). Without that filter this
    // was counting PASS/TRAP games' hypothetical outcomes as if they'd been bet,
    // which pulls the headline win% toward 50% since those are exactly the
    // coin-flip games the model declined to bet on.
    const allTime   = allTimeRes.data || [];
    const atSettled = allTime.filter(p => ["win","loss"].includes(p.result));
    const atWins    = atSettled.filter(p => p.result === "win").length;
    const atLosses  = atSettled.filter(p => p.result === "loss").length;
    const atWinPct  = atSettled.length > 0 ? (atWins/atSettled.length*100).toFixed(1) : null;

    return Response.json({
      allTime:    { wins: atWins, losses: atLosses, winPct: atWinPct, settled: atSettled.length },
      overall:    { picks: picks.length, wins, losses, pending: picks.length - settled.length, winPct, avgEdge, roi },
      daily,
      dailyVolume,
      byTier:     tierRes.data  || [],
      recent:     picks,
      todayPicks: cacheRes.data?.picks || [],
      emailCount: emailRes.count ?? 0,
      subCount:   subRes.count   ?? 0,
    });
  }

  if (action === "pending") {
    const { data } = await getSupabase()
      .from("model_picks")
      .select("*")
      .eq("result", "pending")
      .order("date", { ascending: false });
    return Response.json({ pending: data || [] });
  }

  return Response.json({ error: "Unknown action" }, { status: 400 });
}

// ─────────────────────────────────────────────
// POST: snapshot today's picks OR resolve results
// ─────────────────────────────────────────────
export async function POST(request) {
  if (!await checkAuth(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabase();
  const body = await request.json();
  const { action } = body;

  // ── SNAPSHOT: save today's model picks to DB ──
  if (action === "snapshot") {
    const { picks, date } = body;
    if (!picks?.length) return Response.json({ error: "No picks provided" }, { status: 400 });

    const rows = picks.map(p => ({
      date:          date || new Date().toISOString().split("T")[0],
      game_id:       p.id,
      home_team:     p.homeTeam,
      away_team:     p.awayTeam,
      pick:          p.pick,
      odds:          p.pick === p.homeTeam ? p.homeOdds : p.awayOdds,
      edge:          p.edge,
      tier:          p.tier?.level || "Low",
      is_bet:        p.isBet || false,
      home_odds:     p.homeOdds,
      away_odds:     p.awayOdds,
      commence_time: p.commenceTime,
      result:        "pending",
    }));

    const { data, error } = await getSupabase()
      .from("model_picks")
      .upsert(rows, { onConflict: "date,game_id", ignoreDuplicates: true });

    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ snapshotted: rows.length, date });
  }

  // ── RESOLVE: check MLB API for final scores and update results ──
  if (action === "resolve") {
    const { date } = body;
    const targetDate = date || new Date().toISOString().split("T")[0];

    // Fetch pending picks for this date
    const { data: pending, error: fetchErr } = await getSupabase()
      .from("model_picks")
      .select("*")
      .eq("date", targetDate)
      .eq("result", "pending");

    if (fetchErr) return Response.json({ error: fetchErr.message }, { status: 500 });
    if (!pending?.length) return Response.json({ resolved: 0, message: "No pending picks" });

    // Fetch MLB scores for this date
    const schedRes = await fetch(
      `${MLB_API}/schedule?sportId=1&hydrate=linescore&date=${targetDate}`
    );
    const schedData = await schedRes.json();
    const games = schedData?.dates?.[0]?.games || [];

    let resolved = 0;
    const updates = [];

    for (const pick of pending) {
      // Match pick to MLB game by team name
      const mlbGame = games.find(g => {
        const ht = g.teams?.home?.team?.name?.toLowerCase() || "";
        const at = g.teams?.away?.team?.name?.toLowerCase() || "";
        const ph = pick.home_team?.toLowerCase() || "";
        const pa = pick.away_team?.toLowerCase() || "";
        const lastWord = (s) => s.split(" ").pop();
        return ht.includes(lastWord(ph)) && at.includes(lastWord(pa));
      });

      if (!mlbGame) continue;

      const status = mlbGame.status?.abstractGameState;
      if (status !== "Final") continue; // game not finished yet

      const homeScore = mlbGame.linescore?.teams?.home?.runs ?? null;
      const awayScore = mlbGame.linescore?.teams?.away?.runs ?? null;
      if (homeScore === null || awayScore === null) continue;

      // Determine winner
      let winner = null;
      if (homeScore > awayScore) winner = pick.home_team;
      else if (awayScore > homeScore) winner = pick.away_team;
      // tied score = push (rare in MLB but handle it)

      let result = "push";
      if (winner) result = winner === pick.pick ? "win" : "loss";

      updates.push({
        id:          pick.id,
        result,
        home_score:  homeScore,
        away_score:  awayScore,
        resolved_at: new Date().toISOString(),
      });
      resolved++;
    }

    if (updates.length > 0) {
      for (const update of updates) {
        await getSupabase()
          .from("model_picks")
          .update({
            result:      update.result,
            home_score:  update.home_score,
            away_score:  update.away_score,
            resolved_at: update.resolved_at,
          })
          .eq("id", update.id);
      }
    }

    return Response.json({ resolved, total: pending.length, date: targetDate });
  }

  return Response.json({ error: "Unknown action" }, { status: 400 });
}
