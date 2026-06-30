import { requireAuth } from "../../../../lib/auth.js";
import { fetchNFLOdds } from "../../../../lib/nfl-odds.js";

export async function GET(request) {
  const { error: authError } = await requireAuth(request);
  if (authError) return authError;

  try {
    const games = await fetchNFLOdds();
    return Response.json({ games, count: games.length });
  } catch (e) {
    console.error("NFL odds error", e);
    return Response.json({ games: [], error: e.message }, { status: 500 });
  }
}
