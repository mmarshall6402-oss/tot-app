// GET /api/nfl/team-schedule?team=Kansas City Chiefs&season=2025
// Full-season schedule (incl. bye week) for one team, for the Fantasy tab's
// Schedule sub-tab — distinct from /api/team-schedule (a near-term
// picks_cache-backed lookup used by the game-schedule UI). Not Pro-gated,
// matching the rest of the Fantasy tab (see NFLSection.js).
import { requireAuth } from "../../../../lib/auth.js";
import { computeTeamSeasonSchedule } from "../../../../lib/nfl-schedule.js";

// NFL season "year" runs Sept-Feb; before March it's still last season's
// playoffs/offseason. Mirrors app/api/cron/nfl-fantasy-rankings/route.js's
// currentNflSeason.
function currentNflSeason(now = new Date()) {
  return now.getMonth() >= 2 ? now.getFullYear() : now.getFullYear() - 1;
}

export async function GET(request) {
  const { error: authError } = await requireAuth(request);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const team = (searchParams.get("team") || "").trim();
  if (!team) return Response.json({ error: "team required" }, { status: 400 });
  const season = parseInt(searchParams.get("season"), 10) || currentNflSeason();

  try {
    const schedule = await computeTeamSeasonSchedule(team, season);
    return Response.json(schedule);
  } catch (e) {
    return Response.json({ error: e.message || "Could not load schedule" }, { status: 500 });
  }
}
