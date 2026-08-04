// NFL season "year" runs Sept-Feb; before March it's still last season's
// playoffs/offseason, so anything asking "what season is it" (rankings
// refresh, Sleeper league lookup) should target the season about to start.
export function currentNflSeason(now = new Date()) {
  return now.getMonth() >= 2 ? now.getFullYear() : now.getFullYear() - 1;
}

// "What NFL week is it" has no reliable pure-date formula (season start
// date shifts year to year, bye weeks, etc.) — rather than hand-rolling a
// fragile calendar calculator, this asks SportsData.io directly, the same
// provider already wired for live stats (lib/nfl-fantasy/live-stats.js).
// UNVERIFIED against a live call, same caveat as the rest of this app's
// SportsData.io integration (outbound access to api.sportsdata.io isn't
// reachable from this sandbox) — CurrentWeek is a standard, long-documented
// SportsData.io v3 NFL endpoint. Returns null on any failure or missing
// key: callers (live-call logging) must treat a null week as "unknown,"
// never guess one.
const SPORTSDATA_KEY = process.env.SPORTSDATA_API_KEY;
const SPORTSDATA_BASE = "https://api.sportsdata.io/v3/nfl";

export async function fetchCurrentNflWeek() {
  if (!SPORTSDATA_KEY) return null;
  try {
    const res = await fetch(`${SPORTSDATA_BASE}/scores/json/CurrentWeek?key=${SPORTSDATA_KEY}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const week = Number(await res.json());
    return Number.isFinite(week) && week > 0 ? week : null;
  } catch (e) {
    console.warn("[nfl-fantasy] CurrentWeek fetch failed:", e.message);
    return null;
  }
}
