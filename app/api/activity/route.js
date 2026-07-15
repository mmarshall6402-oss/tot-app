import { createClient } from "@supabase/supabase-js";
import { requirePro } from "../../../lib/auth.js";

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Returns anonymized recent activity events for the social feed.
// Events are derived from saved_picks: recent saves and today's settlements.
export async function GET(request) {
  const { error: authError } = await requirePro(request);
  if (authError) return authError;

  try {
  const supabase = getSupabase();
  const now = new Date();

  // CT today date
  const ctParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const today = `${ctParts.find(x => x.type === "year").value}-${ctParts.find(x => x.type === "month").value}-${ctParts.find(x => x.type === "day").value}`;

  const windowStart = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();

  const [recentRes, settledRes, topRes] = await Promise.all([
    // Recent saves in the last 2 hours
    supabase
      .from("saved_picks")
      .select("user_id, home_team, away_team, pick, odds, tier, created_at")
      .gte("created_at", windowStart)
      .order("created_at", { ascending: false })
      .limit(30),

    // Today's settled picks (wins and losses)
    supabase
      .from("saved_picks")
      .select("user_id, home_team, away_team, pick, odds, tier, result, created_at")
      .like("commence_time", `${today}%`)
      .in("result", ["win", "loss"])
      .order("created_at", { ascending: false })
      .limit(30),

    // Most tracked games today (for "X people on this pick" counts)
    supabase
      .from("saved_picks")
      .select("game_id, home_team, away_team, pick, tier")
      .like("commence_time", `${today}%`),
  ]);

  const recent = recentRes.data || [];
  const settled = settledRes.data || [];
  const all = topRes.data || [];

  // Count trackers per game
  const gameCounts = {};
  for (const row of all) {
    const key = row.game_id || `${row.home_team}|${row.away_team}`;
    if (!gameCounts[key]) gameCounts[key] = { home: row.home_team, away: row.away_team, count: 0, tier: row.tier };
    gameCounts[key].count++;
  }
  const topPicks = Object.values(gameCounts)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
    .filter(g => g.count >= 2);

  // Anonymize: stable handle from first 6 chars of user_id
  const handle = (uid) => `#${(uid || "unknown").replace(/-/g, "").slice(0, 6)}`;

  // Build P&L for a win (assuming $10 unit)
  const UNIT = 10;
  const pnl = (odds) => {
    if (!odds) return null;
    const p = odds > 0 ? (UNIT * odds / 100) : (UNIT * 100 / Math.abs(odds));
    return Math.round(p * 100) / 100;
  };

  const secsAgo = (iso) => Math.max(0, Math.round((now - new Date(iso)) / 1000));

  // Merge and deduplicate events, newest first
  const events = [];

  for (const r of recent) {
    events.push({
      type: "tracked",
      handle: handle(r.user_id),
      pick: (r.pick || "").split(" ").pop(),
      pickFull: r.pick,
      homeTeam: r.home_team,
      awayTeam: r.away_team,
      tier: r.tier,
      odds: r.odds,
      ago: secsAgo(r.created_at),
      ts: r.created_at,
    });
  }

  for (const r of settled) {
    const won = r.result === "win";
    events.push({
      type: won ? "hit" : "miss",
      handle: handle(r.user_id),
      pick: (r.pick || "").split(" ").pop(),
      pickFull: r.pick,
      homeTeam: r.home_team,
      awayTeam: r.away_team,
      tier: r.tier,
      odds: r.odds,
      pnl: won ? pnl(r.odds) : null,
      ago: secsAgo(r.created_at),
      ts: r.created_at,
    });
  }

  // Sort newest first, cap at 40 total events
  events.sort((a, b) => a.ago - b.ago);
  const deduped = events.slice(0, 40);

  return Response.json({ events: deduped, topPicks, today });
  } catch (e) {
    console.error("[activity] fatal:", e);
    return Response.json({ error: e?.message || e?.name || "unknown error" }, { status: 500 });
  }
}
