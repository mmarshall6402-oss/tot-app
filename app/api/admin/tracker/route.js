// app/api/admin/tracker/route.js
// Private admin route — protected by ADMIN_KEY env var
// Handles: snapshotting picks, resolving results, fetching stats

import { createClient } from "@supabase/supabase-js";

const MLB_API = "https://statsapi.mlb.com/api/v1";

// Create client lazily — env vars not available at build time
const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function checkAuth(request) {
  const key = request.headers.get("x-admin-key");
  if (key !== process.env.ADMIN_KEY) return false;
  return true;
}

// ─────────────────────────────────────────────
// GET: fetch tracker stats + recent picks
// ─────────────────────────────────────────────
export async function GET(request) {
  if (!checkAuth(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action") || "stats";
  const days   = parseInt(searchParams.get("days") || "30");

  if (action === "stats") {
    const since = new Date();
    since.setDate(since.getDate() - days);
    const sinceStr = since.toISOString().split("T")[0];

    const [dailyRes, tierRes, recentRes] = await Promise.all([
      getSupabase().from("model_daily_stats").select("*").gte("date", sinceStr),
      getSupabase().from("model_tier_stats").select("*"),
      getSupabase().from("model_picks")
        .select("*")
        .gte("date", sinceStr)
        .order("date", { ascending: false })
        .order("edge", { ascending: false })
        .limit(500),
    ]);

    // Overall stats
    const picks = recentRes.data || [];
    const bets   = picks.filter(p => p.is_bet);
    const settled = bets.filter(p => ["win","loss"].includes(p.result));
    const wins   = settled.filter(p => p.result === "win").length;
    const losses = settled.filter(p => p.result === "loss").length;
    const winPct = settled.length > 0 ? (wins / settled.length * 100).toFixed(1) : null;
    const avgEdge = bets.length > 0
      ? (bets.reduce((s,p) => s + (p.edge||0), 0) / bets.length).toFixed(2)
      : null;
    // ROI: flat betting -110 (risk 100, win 90.9)
    const roi = settled.length > 0
      ? ((wins * 90.9 - losses * 100) / settled.length).toFixed(1)
      : null;

    return Response.json({
      overall: { bets: bets.length, wins, losses, pending: bets.length - settled.length, winPct, avgEdge, roi },
      daily:   dailyRes.data || [],
      byTier:  tierRes.data  || [],
      recent:  picks,
    });
  }

  if (action === "pending") {
    const { data } = await supabase
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
  if (!checkAuth(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

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

    const { data, error } = await supabase
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
    const { data: pending, error: fetchErr } = await supabase
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
        await supabase
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
