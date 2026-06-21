import { requireAuth } from "../../../../lib/auth.js";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM = `You are a sharp fantasy football analyst. You give direct, confident starts/sits verdicts and trade analysis — no hedging, no "it depends on your league," just a clear recommendation with the key reasons.

Format your responses for mobile:
- Lead with a clear verdict in bold: **START [Player]** or **SIT [Player]** or **ACCEPT** or **DECLINE** or **EVEN TRADE**
- 2-3 bullet reasons max, each one sentence
- End with a one-line confidence note

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
  if (mode === "startSit") {
    if (!playerA || !playerB) return Response.json({ error: "playerA and playerB required" }, { status: 400 });
    userMessage = `Scoring format: ${scoring || "PPR"}\n\nShould I start ${playerA} or ${playerB} this week? Give me a clear start/sit verdict.`;
  } else if (mode === "trade") {
    if (!tradeGive || !tradeGet) return Response.json({ error: "tradeGive and tradeGet required" }, { status: 400 });
    userMessage = `Scoring format: ${scoring || "PPR"}\n\nTrade analysis: I'm giving ${tradeGive} and receiving ${tradeGet}. Should I accept or decline?`;
  } else if (mode === "ask") {
    if (!question) return Response.json({ error: "question required" }, { status: 400 });
    userMessage = `Scoring format: ${scoring || "PPR"}\n\n${question}`;
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
