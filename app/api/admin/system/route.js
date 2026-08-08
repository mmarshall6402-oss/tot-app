// app/api/admin/system/route.js
// Private admin route — powers the System tab on /admin.
// action=health: live-probes The Odds API / SportsGameOdds / ESPN and reports
//   Supabase odds-cache staleness for MLB + NFL.
// action=errors: recent rows from error_log (see sql/020_error_log.sql and
//   lib/error-log.js) — self-logged failures, since Vercel Hobby doesn't expose
//   durable runtime logs via API.
// Supersedes the old app/api/admin/debug-odds route, which had no auth check.

import { createClient } from "@supabase/supabase-js";
import { requireAuth } from "../../../../lib/auth.js";

const TOA_KEY  = process.env.THE_ODDS_API_KEY;
const TOA_BASE = "https://api.the-odds-api.com/v4";
const SGO_KEY  = process.env.SPORTSGAMEODDS_API_KEY;
const SGO_BASE = "https://api.sportsgameodds.com/v2";
const ODDS_TTL_MIN = 15; // matches ODDS_TTL_MS in lib/mlb-picks.js / app/api/nfl/picks/route.js

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

async function probeTOA() {
  try {
    if (!TOA_KEY) throw new Error("THE_ODDS_API_KEY env var not set");
    const url = `${TOA_BASE}/sports/baseball_mlb/odds?apiKey=${TOA_KEY}&regions=us&markets=h2h&oddsFormat=american&dateFormat=iso`;
    const r = await fetch(url);
    const remaining = r.headers.get("x-requests-remaining");
    const used = r.headers.get("x-requests-used");
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      return { ok: false, status: r.status, error: body.slice(0, 200) };
    }
    const events = await r.json();
    return {
      ok: true,
      games: Array.isArray(events) ? events.length : 0,
      requestsRemaining: remaining,
      requestsUsed: used,
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function probeSGO() {
  try {
    if (!SGO_KEY) throw new Error("SPORTSGAMEODDS_API_KEY env var not set");
    const params = new URLSearchParams({ leagueID: "MLB", oddID: "points-home-game-ml-home,points-away-game-ml-away", oddsAvailable: "true", limit: "50", apiKey: SGO_KEY });
    const r = await fetch(`${SGO_BASE}/events?${params}`);
    if (!r.ok) return { ok: false, status: r.status };
    const json = await r.json();
    return { ok: !json?.error, games: json?.data?.length ?? 0, error: json?.error || null };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function probeESPN() {
  try {
    const today = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(new Date()).reduce((a, p) => ({ ...a, [p.type]: p.value }), {});
    const d = `${today.year}${today.month}${today.day}`;
    const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard?dates=${d}`);
    if (!r.ok) return { ok: false, status: r.status };
    const json = await r.json();
    const events = json?.events || [];
    const withOdds = events.filter(e => {
      const comp = e.competitions?.[0];
      return (comp?.odds || []).some(o => o.homeTeamOdds?.moneyLine != null || o.homeTeamOdds?.current?.moneyLine != null);
    });
    return { ok: true, totalGames: events.length, gamesWithOdds: withOdds.length };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function cacheAge(sb, table) {
  const { data } = await sb.from(table).select("generated_at").eq("date", "__odds__").single();
  if (!data?.generated_at) return { generatedAt: null, ageMin: null, stale: true };
  const ageMin = Math.round((Date.now() - new Date(data.generated_at).getTime()) / 60000);
  return { generatedAt: data.generated_at, ageMin, stale: ageMin > ODDS_TTL_MIN };
}

export async function GET(request) {
  if (!await checkAuth(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action") || "health";
  const sb = getSupabase();

  if (action === "health") {
    const [toa, sgo, espn, mlbCache, nflCache] = await Promise.all([
      probeTOA(),
      probeSGO(),
      probeESPN(),
      cacheAge(sb, "picks_cache").catch(() => ({ generatedAt: null, ageMin: null, stale: true })),
      cacheAge(sb, "nfl_picks_cache").catch(() => ({ generatedAt: null, ageMin: null, stale: true })),
    ]);
    return Response.json({ checkedAt: new Date().toISOString(), sources: { toa, sgo, espn }, cache: { mlb: mlbCache, nfl: nflCache } });
  }

  if (action === "errors") {
    const hours = Math.min(parseInt(searchParams.get("hours") || "24"), 168);
    const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
    const { data: recent, error } = await sb
      .from("error_log")
      .select("*")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) return Response.json({ recent: [], bySource: [], windowHours: hours, tableMissing: true });

    const bySourceMap = new Map();
    for (const row of recent || []) {
      bySourceMap.set(row.source, (bySourceMap.get(row.source) || 0) + 1);
    }
    const bySource = [...bySourceMap.entries()].map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count);

    return Response.json({ recent: recent || [], bySource, windowHours: hours });
  }

  return Response.json({ error: "Unknown action" }, { status: 400 });
}
