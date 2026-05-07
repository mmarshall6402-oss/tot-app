// app/api/steals/route.js

import { fetchMLBOdds } from "../../../lib/odds.js";
import { getModelProbability } from "../../../lib/probability.js";
import { calculateEdge, getConfidenceTier } from "../../../lib/edge.js";

export async function GET() {
  try {
    const games = await fetchMLBOdds();

    const results = await Promise.all(
      games.map(async (game) => {
        const modelProb = await getModelProbability(game);
        const edge = calculateEdge(modelProb, game.homeImplied);
        const tier = getConfidenceTier(edge);
        if (!tier || tier.level !== "High") return null;
        return { ...game, edge, tier };
      })
    );

    const steals = results.filter(Boolean);
    return Response.json({ steals });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
