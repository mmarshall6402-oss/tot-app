// app/api/search/route.js
// Global team + player directory search — the piece the old client-only
// SearchOverlay was missing (it could only filter games already loaded for
// today). Not Pro-gated, matching app/api/team/route.js's auth level.
import { requireAuth } from "../../../lib/auth.js";
import { getMLBTeams, getNFLTeams, searchTeams } from "../../../lib/team-list.js";
import { searchMLBPlayers } from "../../../lib/mlb-players.js";
import { searchNFLPlayers } from "../../../lib/nfl-roster.js";

export async function GET(request) {
  const { error: authError } = await requireAuth(request);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") || "").trim();
  const sport = (searchParams.get("sport") || "all").toLowerCase();
  if (q.length < 2) return Response.json({ teams: [], players: [] });

  const wantMLB = sport === "all" || sport === "mlb";
  const wantNFL = sport === "all" || sport === "nfl";

  try {
    const [mlbTeams, nflTeams, mlbPlayers, nflPlayers] = await Promise.all([
      wantMLB ? getMLBTeams().catch(() => []) : [],
      wantNFL ? getNFLTeams().catch(() => []) : [],
      wantMLB ? searchMLBPlayers(q, 6) : [],
      wantNFL ? searchNFLPlayers(q, 6) : [],
    ]);

    const teams = [
      ...searchTeams(mlbTeams, q, "mlb"),
      ...searchTeams(nflTeams, q, "nfl"),
    ].slice(0, 10);

    const players = [
      ...mlbPlayers.map(p => ({ ...p, sport: "mlb" })),
      ...nflPlayers.map(p => ({ ...p, sport: "nfl" })),
    ].slice(0, 10);

    return Response.json({ teams, players });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
