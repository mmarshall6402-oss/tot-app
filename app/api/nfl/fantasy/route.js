import { requireAuth, requireFantasyCallAllowance } from "../../../../lib/auth.js";
import { lookupNFLPlayer, formatNFLPlayerContext, findMentionedNFLPlayers } from "../../../../lib/nfl-roster.js";
import { rankingsContextLine } from "../../../../lib/nfl-fantasy/lookup.js";
import { propLineForPlayer } from "../../../../lib/nfl-fantasy/prop-line.js";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Resolves each comma-separated name in a start/sit or trade field to real
// roster/injury context via ESPN, preferring the VORP/projection-grounded
// nfl_fantasy_rankings line (lib/nfl-fantasy/lookup.js) when the player has
// one. Unresolvable names are silently dropped — Claude falls back to its
// own knowledge for those, so a bad/unknown name never blocks the request.
// Combines the VORP/projection ranking line (or the plain ESPN roster/injury
// fallback) with the sportsbook's own prop line for that player's signature
// stat, so Claude — and by extension the user — sees our projection and the
// market's price for the same player in one block instead of two lookups.
async function contextLineForPlayer(p, scoring) {
  const [rankingLine, propLine] = await Promise.all([
    rankingsContextLine(p, scoring).catch(() => null),
    propLineForPlayer(p).catch(() => null),
  ]);
  const base = rankingLine || formatNFLPlayerContext(p);
  if (!base) return null;
  return propLine ? `${base}\n${propLine}` : base;
}

async function playerContextBlock(namesField, scoring) {
  const names = (namesField || "").split(",").map(n => n.trim()).filter(Boolean);
  if (!names.length) return null;
  const players = await Promise.all(names.map(n => lookupNFLPlayer(n)));
  const lines = await Promise.all(players.map(p => contextLineForPlayer(p, scoring)));
  const filtered = lines.filter(Boolean);
  return filtered.length ? filtered.join("\n") : null;
}

// A player picked from the /api/search-backed typeahead (components/NFLSection.js's
// PlayerSearchInput) arrives as the exact {id, name, team, position} row instead of
// free text — skip the fuzzy roster-name match entirely and go straight to
// grounding, since there's no ambiguity left to resolve.
function isResolvedPlayer(info) {
  return !!(info && typeof info.name === "string" && info.name.trim());
}

async function resolvedPlayerContext(info, scoring) {
  return contextLineForPlayer(info, scoring);
}

async function playerContext(namesField, info, scoring) {
  return isResolvedPlayer(info) ? resolvedPlayerContext(info, scoring) : playerContextBlock(namesField, scoring);
}

const SYSTEM = `You are a sharp fantasy football analyst. You give direct, confident starts/sits verdicts and trade analysis — no hedging, no "it depends on your league," just a clear recommendation with the key reasons.

Format your responses for mobile:
- Lead with a clear verdict in bold: **START [Player]** or **SIT [Player]** or **ACCEPT** or **DECLINE** or **EVEN TRADE**
- 2-3 bullet reasons max, each one sentence
- End with a one-line confidence note

If current roster/injury data is provided in the message, treat it as more reliable than your own training knowledge (rosters and injury designations change constantly) — lead with it when it's decisive. If a line includes VORP/projection/tier numbers, treat those as ground truth over your own training-knowledge point estimates — reserve your own knowledge for qualitative narrative (matchup, scheme fit, recent news) rather than re-deriving a point total.

If a line includes a "Market prop" (a sportsbook's Over/Under or Yes/No line for that player's signature stat), call it out explicitly and compare it to our own projection/VORP for that player — e.g. "the book has him at 4.5 receptions, we project 5.8" — since seeing the market price next to our number in the same answer is the whole point. Only mention it when it's actually provided; never invent a prop line.

For starts/sits: consider target share, snap count trends, matchup grade, scoring format, injury status, and recent usage. Give the better play clearly.

For trade analysis: evaluate both sides by projected points, positional scarcity, roster construction context, and rest-of-season outlook.

Keep responses under 150 words. Be decisive.`;

export async function POST(request) {
  let body;
  try { body = await request.json(); } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { mode, playerA, playerB, playerAInfo, playerBInfo, scoring, tradeGive, tradeGet, tradeGiveInfo, tradeGetInfo, question } = body;

  // Start/Sit is the free tier's rate-limited feature (3/week, see
  // lib/auth.js) — Trade, Ask, and the cheat sheet stay unmetered.
  const { error: authError } = mode === "startSit"
    ? await requireFantasyCallAllowance(request)
    : await requireAuth(request);
  if (authError) return authError;

  let userMessage;
  if (mode === "startSit") {
    if (!playerA || !playerB) return Response.json({ error: "playerA and playerB required" }, { status: 400 });
    const [ctxA, ctxB] = await Promise.all([playerContext(playerA, playerAInfo, scoring), playerContext(playerB, playerBInfo, scoring)]);
    const context = [ctxA, ctxB].filter(Boolean).join("\n");
    userMessage = `Scoring format: ${scoring || "PPR"}\n\n` +
      (context ? `Current roster/injury/projection data:\n${context}\n\n` : "") +
      `Should I start ${playerA} or ${playerB} this week? Give me a clear start/sit verdict.`;
  } else if (mode === "trade") {
    if (!tradeGive || !tradeGet) return Response.json({ error: "tradeGive and tradeGet required" }, { status: 400 });
    const [ctxGive, ctxGet] = await Promise.all([playerContext(tradeGive, tradeGiveInfo, scoring), playerContext(tradeGet, tradeGetInfo, scoring)]);
    const context = [ctxGive, ctxGet].filter(Boolean).join("\n");
    userMessage = `Scoring format: ${scoring || "PPR"}\n\n` +
      (context ? `Current roster/injury/projection data:\n${context}\n\n` : "") +
      `Trade analysis: I'm giving ${tradeGive} and receiving ${tradeGet}. Should I accept or decline?`;
  } else if (mode === "ask") {
    if (!question) return Response.json({ error: "question required" }, { status: 400 });
    const mentioned = await findMentionedNFLPlayers(question).catch(() => []);
    const lines = await Promise.all(mentioned.map(p => contextLineForPlayer(p, scoring)));
    const context = lines.filter(Boolean).join("\n");
    userMessage = `Scoring format: ${scoring || "PPR"}\n\n` +
      (context ? `Current roster/injury/projection data for players mentioned below:\n${context}\n\n` : "") +
      question;
  } else {
    return Response.json({ error: "mode must be startSit, trade, or ask" }, { status: 400 });
  }

  try {
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      system: SYSTEM,
      messages: [{ role: "user", content: userMessage }],
    });
    const text = msg.content[0]?.text || "";
    return Response.json({ result: text });
  } catch (e) {
    console.error("NFL fantasy API error", e);
    return Response.json({ error: "AI error" }, { status: 500 });
  }
}
