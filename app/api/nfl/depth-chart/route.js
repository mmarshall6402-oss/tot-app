// GET /api/nfl/depth-chart?team=Kansas City Chiefs
// Not Pro-gated, matching the rest of the Fantasy tab (see NFLSection.js).
import { requireAuth } from "../../../../lib/auth.js";
import { fetchSleeperPlayerIndex } from "../../../../lib/nfl-fantasy/sleeper.js";
import { buildDepthChart } from "../../../../lib/nfl-fantasy/depth-chart.js";

export async function GET(request) {
  const { error: authError } = await requireAuth(request);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const team = (searchParams.get("team") || "").trim();
  if (!team) return Response.json({ error: "team required" }, { status: 400 });

  try {
    const sleeperIndex = await fetchSleeperPlayerIndex();
    const chart = buildDepthChart(sleeperIndex, team);
    if (!chart.positions.length) {
      return Response.json({ error: `No depth chart data available for ${chart.team || team} yet` }, { status: 404 });
    }
    return Response.json(chart);
  } catch (e) {
    return Response.json({ error: e.message || "Could not load depth chart" }, { status: 500 });
  }
}
