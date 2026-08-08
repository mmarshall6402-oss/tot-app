// app/api/admin/system/route.js
// Private admin route — powers the System tab and Rate Limits tab on /admin.
//
// action=health: live-probes The Odds API / SportsGameOdds / ESPN (MLB) and
//   reports Supabase odds-cache staleness for MLB + NFL. Cheap, used by the
//   System tab.
// action=extended-health: everything in health, plus NFL TOA/SGO probes and
//   an Anthropic probe. Pricier (more live calls), used by the Rate Limits tab.
// action=quota-trend: api_quota_log history (sql/022) — snapshots captured off
//   real traffic, not dedicated probes, so reading this doesn't spend quota.
// action=claim-stats: prop_claim_daily_stats (sql/023) — claimed-vs-skipped
//   counts from the claim_prop_fetch dedup (sql/021).
// action=errors: recent rows from error_log (sql/020) — self-logged failures,
//   since Vercel Hobby doesn't expose durable runtime logs via API.
// POST action=bust-cache: deletes the Supabase odds-cache row for a sport so
//   the next request fetches live instead of serving stale data.
//
// Supersedes the old app/api/admin/debug-odds route, which had no auth check.

import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import { requireAuth } from "../../../../lib/auth.js";
import { logQuotaSnapshot } from "../../../../lib/quota-log.js";

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

// sportPath: "baseball_mlb" or "americanfootball_nfl". Logs the real quota
// headers off this call — it's a live TOA request either way, so might as
// well feed the trend rather than waste it.
async function probeTOA(sportPath = "baseball_mlb") {
  try {
    if (!TOA_KEY) throw new Error("THE_ODDS_API_KEY env var not set");
    const url = `${TOA_BASE}/sports/${sportPath}/odds?apiKey=${TOA_KEY}&regions=us&markets=h2h&oddsFormat=american&dateFormat=iso`;
    const r = await fetch(url);
    const remaining = r.headers.get("x-requests-remaining");
    const used = r.headers.get("x-requests-used");
    logQuotaSnapshot("toa", remaining, used);
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

async function probeSGO(leagueID = "MLB") {
  try {
    if (!SGO_KEY) throw new Error("SPORTSGAMEODDS_API_KEY env var not set");
    const params = new URLSearchParams({ leagueID, oddID: "points-home-game-ml-home,points-away-game-ml-away", oddsAvailable: "true", limit: "50", apiKey: SGO_KEY });
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

// Minimal-cost reachability probe (max_tokens: 1) — just needs to confirm
// the key is valid and not quota'd, not produce real output.
async function probeAnthropic() {
  try {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY env var not set");
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1,
      messages: [{ role: "user", content: "hi" }],
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, status: e.status || null, error: e.message };
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

  if (action === "health" || action === "extended-health") {
    const extended = action === "extended-health";
    const probes = [
      probeTOA("baseball_mlb"),
      probeSGO("MLB"),
      probeESPN(),
      cacheAge(sb, "picks_cache").catch(() => ({ generatedAt: null, ageMin: null, stale: true })),
      cacheAge(sb, "nfl_picks_cache").catch(() => ({ generatedAt: null, ageMin: null, stale: true })),
    ];
    if (extended) {
      probes.push(probeTOA("americanfootball_nfl"), probeSGO("NFL"), probeAnthropic());
    }
    const results = await Promise.all(probes);
    const [toa, sgo, espn, mlbCache, nflCache, nflToa, nflSgo, anthropic] = results;
    const body = { checkedAt: new Date().toISOString(), sources: { toa, sgo, espn }, cache: { mlb: mlbCache, nfl: nflCache } };
    if (extended) {
      body.sources.nflToa = nflToa;
      body.sources.nflSgo = nflSgo;
      body.sources.anthropic = anthropic;
    }
    return Response.json(body);
  }

  if (action === "quota-trend") {
    const hours = Math.min(parseInt(searchParams.get("hours") || "48"), 168);
    const source = searchParams.get("source") || "toa";
    const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
    const { data, error } = await sb
      .from("api_quota_log")
      .select("requests_remaining, requests_used, recorded_at")
      .eq("source", source)
      .gte("recorded_at", since)
      .order("recorded_at", { ascending: true })
      .limit(500);
    if (error) return Response.json({ points: [], windowHours: hours, tableMissing: true });
    return Response.json({ points: data || [], windowHours: hours });
  }

  if (action === "claim-stats") {
    const days = Math.min(parseInt(searchParams.get("days") || "7"), 30);
    const since = new Date(Date.now() - days * 86400000).toISOString().split("T")[0];
    const { data, error } = await sb
      .from("prop_claim_daily_stats")
      .select("*")
      .gte("date", since)
      .order("date", { ascending: true });
    if (error) return Response.json({ days: [], totals: { claimed: 0, skipped: 0 }, tableMissing: true });
    const totals = (data || []).reduce((a, r) => ({ claimed: a.claimed + r.claimed_count, skipped: a.skipped + r.skipped_count }), { claimed: 0, skipped: 0 });
    return Response.json({ days: data || [], totals });
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

const BUSTABLE = {
  mlb: { table: "picks_cache" },
  nfl: { table: "nfl_picks_cache" },
};

export async function POST(request) {
  if (!await checkAuth(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  if (body.action !== "bust-cache") {
    return Response.json({ error: "Unknown action" }, { status: 400 });
  }
  const target = BUSTABLE[body.sport];
  if (!target) return Response.json({ error: "sport must be mlb or nfl" }, { status: 400 });

  const sb = getSupabase();
  const { error } = await sb.from(target.table).delete().eq("date", "__odds__");
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true, sport: body.sport });
}
