// app/api/teams/route.js
// Full team directory for a sport — the list backing the new Teams browse
// section (components/TeamsSection.js), as opposed to app/api/team/route.js
// which resolves one named team into its roster/standings/schedule.
// getMLBTeams/getNFLTeams are already cached 12h by lib/team-list.js for the
// search endpoint, so this adds no new load.
import { requireAuth } from "../../../lib/auth.js";
import { getMLBTeams, getNFLTeams } from "../../../lib/team-list.js";

export async function GET(request) {
  const { error: authError } = await requireAuth(request);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const sport = (searchParams.get("sport") || "mlb").toLowerCase();

  try {
    if (sport === "nfl") {
      const teams = await getNFLTeams();
      return Response.json({
        sport: "nfl",
        teams: teams
          .map(t => ({ name: t.displayName || null, division: null }))
          .filter(t => t.name)
          .sort((a, b) => a.name.localeCompare(b.name)),
      });
    }
    const teams = await getMLBTeams();
    return Response.json({
      sport: "mlb",
      teams: teams
        .map(t => ({ name: t.name || null, division: t.division?.name || null }))
        .filter(t => t.name)
        .sort((a, b) => a.name.localeCompare(b.name)),
    });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
