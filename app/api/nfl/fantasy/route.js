import { requireAuth } from "../../../../lib/auth.js";
import { lookupNFLPlayer, formatNFLPlayerContext, findMentionedNFLPlayers } from "../../../../lib/nfl-roster.js";
import { rankingsContextLine, rankingsRow } from "../../../../lib/nfl-fantasy/lookup.js";
import { headToHeadProbability } from "../../../../lib/nfl-fantasy/probability.js";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Resolves each comma-separated name in a start/sit or trade field to real
// roster/injury context via ESPN, preferring the VORP/projection-grounded
// nfl_fantasy_rankings line (lib/nfl-fantasy/lookup.js) when the player has
// one. Unresolvable names are silently dropped — Claude falls back to its
// own knowledge for those, so a bad/unknown name never blocks the request.
async function playerContextBlock(namesField, scoring) {
  const names = (namesField || "").split(",").map(n => n.trim()).filter(Boolean);
  if (!names.length) return null;
  const players = await Promise.all(names.map(n => lookupNFLPlayer(n)));
  const lines = await Promise.all(players.map(async (p) => {
    const rankingLine = await rankingsContextLine(p, scoring).catch(() => null);
    return rankingLine || formatNFLPlayerContext(p);
  }));
  const filtered = lines.filter(Boolean);
  return filtered.length ? filtered.join("\n") : null;
}

// The calibrated part of start/sit: a real P(playerA outscores playerB) this
// week, derived from each player's stored season projection, rather than an
// LLM's confidence adjective. Only fires for a clean single-name-per-side
// comparison (the UI's actual usage) — a comma-separated multi-player field
// (as trade mode allows) has no single head-to-head to score, so it's left
// to the plain-text playerContextBlock path instead. Returns null on any
// resolution miss (unranked/rookie/name mismatch) — caller falls back to
// the LLM-only verdict with no probability attached.
async function startSitProbability(playerAName, playerBName, scoring) {
  if (playerAName.includes(",") || playerBName.includes(",")) return null;
  try {
    const [espnA, espnB] = await Promise.all([lookupNFLPlayer(playerAName), lookupNFLPlayer(playerBName)]);
    const [rowA, rowB] = await Promise.all([rankingsRow(espnA, scoring), rankingsRow(espnB, scoring)]);
    if (!rowA || !rowB) return null;
    return headToHeadProbability(rowA, rowB);
  } catch (e) {
    console.warn("[nfl-fantasy] start/sit probability failed:", e.message);
    return null;
  }
}

const SYSTEM = `You are a sharp fantasy football analyst. You give direct, confident starts/sits verdicts and trade analysis — no hedging, no "it depends on your league," just a clear recommendation with the key reasons.

Format your responses for mobile:
- Lead with a clear verdict in bold: **START [Player]** or **SIT [Player]** or **ACCEPT** or **DECLINE** or **EVEN TRADE**
- 2-3 bullet reasons max, each one sentence
- End with a one-line confidence note

If current roster/injury data is provided in the message, treat it as more reliable than your own training knowledge (rosters and injury designations change constantly) — lead with it when it's decisive. If a line includes VORP/projection/tier numbers, treat those as ground truth over your own training-knowledge point estimates — reserve your own knowledge for qualitative narrative (matchup, scheme fit, recent news) rather than re-deriving a point total.

For starts/sits: consider target share, snap count trends, matchup grade, scoring format, injury status, and recent usage. Give the better play clearly.

For trade analysis: evaluate both sides by projected points, positional scarcity, roster construction context, and rest-of-season outlook.

Keep responses under 150 words. Be decisive.`;

export async function POST(request) {
  const { error: authError } = await requireAuth(request);
  if (authError) return authError;

  let body;
  try { body = await request.json(); } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { mode, playerA, playerB, scoring, tradeGive, tradeGet, question } = body;

  let userMessage;
  let probability = null;
  if (mode === "startSit") {
    if (!playerA || !playerB) return Response.json({ error: "playerA and playerB required" }, { status: 400 });
    const [ctxA, ctxB, prob] = await Promise.all([
      playerContextBlock(playerA, scoring),
      playerContextBlock(playerB, scoring),
      startSitProbability(playerA.trim(), playerB.trim(), scoring),
    ]);
    probability = prob;
    const context = [ctxA, ctxB].filter(Boolean).join("\n");
    const probLine = probability
      ? `\nModel win probability this week: ${playerA} ${probability.playerAProbability}% vs ${playerB} ${probability.playerBProbability}%. Treat this as ground truth — your verdict should agree with it, and your reasons should explain why, not contradict it.\n`
      : "";
    userMessage = `Scoring format: ${scoring || "PPR"}\n\n` +
      (context ? `Current roster/injury/projection data:\n${context}\n\n` : "") +
      probLine +
      `Should I start ${playerA} or ${playerB} this week? Give me a clear start/sit verdict.`;
  } else if (mode === "trade") {
    if (!tradeGive || !tradeGet) return Response.json({ error: "tradeGive and tradeGet required" }, { status: 400 });
    const [ctxGive, ctxGet] = await Promise.all([playerContextBlock(tradeGive, scoring), playerContextBlock(tradeGet, scoring)]);
    const context = [ctxGive, ctxGet].filter(Boolean).join("\n");
    userMessage = `Scoring format: ${scoring || "PPR"}\n\n` +
      (context ? `Current roster/injury/projection data:\n${context}\n\n` : "") +
      `Trade analysis: I'm giving ${tradeGive} and receiving ${tradeGet}. Should I accept or decline?`;
  } else if (mode === "ask") {
    if (!question) return Response.json({ error: "question required" }, { status: 400 });
    const mentioned = await findMentionedNFLPlayers(question).catch(() => []);
    const lines = await Promise.all(mentioned.map(async (p) => (await rankingsContextLine(p, scoring).catch(() => null)) || formatNFLPlayerContext(p)));
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
    return Response.json({ result: text, probability });
  } catch (e) {
    console.error("NFL fantasy API error", e);
    return Response.json({ error: "AI error" }, { status: 500 });
  }
}
