// Resolves two typed-in player names to their nfl_fantasy_rankings rows and
// scores the head-to-head probability between them — the shared "look these
// two up and grade them" step behind both the live Start/Sit verdict
// (app/api/nfl/fantasy/route.js) and gut-call logging
// (app/api/nfl/fantasy/gut-calls/route.js). Only handles a clean
// single-name-per-side comparison — a comma-separated field (as the Trade
// tool's multi-player fields allow) has no single head-to-head to score.
// Returns null on any resolution miss (unranked/rookie/name mismatch) —
// callers fall back to their own no-probability behavior.
import { lookupNFLPlayer } from "../nfl-roster.js";
import { rankingsRow } from "./lookup.js";
import { headToHeadProbability } from "./probability.js";

export async function resolveHeadToHead(playerAName, playerBName, scoring) {
  if (!playerAName || !playerBName || playerAName.includes(",") || playerBName.includes(",")) return null;
  try {
    const [espnA, espnB] = await Promise.all([lookupNFLPlayer(playerAName), lookupNFLPlayer(playerBName)]);
    const [rowA, rowB] = await Promise.all([rankingsRow(espnA, scoring), rankingsRow(espnB, scoring)]);
    if (!rowA || !rowB) return null;
    const probability = headToHeadProbability(rowA, rowB);
    if (!probability) return null;
    return { probability, rowA, rowB };
  } catch (e) {
    console.warn("[nfl-fantasy] head-to-head resolution failed:", e.message);
    return null;
  }
}
