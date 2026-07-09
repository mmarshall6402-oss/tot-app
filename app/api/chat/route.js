import { requireAuth } from "../../../lib/auth.js";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM = `You are a sharp MLB betting assistant for the This or That (T|T) platform. Your job is to help users find the best bets from today's available picks.

You have access to today's picks data provided in the conversation. When analyzing:
- Highlight games with the biggest edge (model edge %)
- Call out value underdogs where the model likes them but odds are long
- Identify mismatches where one team's pitcher has a big ERA/WHIP advantage
- Flag "Value Pick" (🔥) and "Solid Pick" (✅) tier games as your top recommendations
- Be direct, concise, and specific — use team names, odds, edge %
- If asked about parlays, suggest 2-3 leg combos from the top-edge picks
- Don't recommend bets not in today's data
- Format responses for mobile — short paragraphs, use line breaks, bold key numbers with ** **

Keep responses under 200 words unless the user asks for detail. No fluff.`;

export async function POST(request) {
  const { error: authError } = await requireAuth(request);
  if (authError) return authError;

  let body;
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { messages, picksContext } = body;
  if (!messages?.length) return Response.json({ error: "messages required" }, { status: 400 });

  // Build context string from today's picks
  let contextBlock = "";
  if (picksContext?.length) {
    const lines = picksContext.map(p => {
      const odds = p.pick === p.homeTeam ? p.homeOdds : p.awayOdds;
      const oppOdds = p.pick === p.homeTeam ? p.awayOdds : p.homeOdds;
      const oddsStr = odds != null ? (odds > 0 ? `+${odds}` : `${odds}`) : "?";
      const oppStr = oppOdds != null ? (oppOdds > 0 ? `+${oppOdds}` : `${oppOdds}`) : "?";
      const edge = p.edge != null ? `${Number(p.edge).toFixed(1)}%` : "?";
      const tier = p.tier?.level || "Low";
      const hp = p.breakdown?.pitcher_home || "TBD";
      const ap = p.breakdown?.pitcher_away || "TBD";
      return `${p.awayTeam} @ ${p.homeTeam} — Pick: **${p.pick}** (${oddsStr}) | Opp: ${oppStr} | Edge: ${edge} | Tier: ${tier} | HP: ${hp} | AP: ${ap}`;
    });
    contextBlock = `\nToday's picks data:\n${lines.join("\n")}\n`;
  }

  // Prepend context as a dedicated user/assistant exchange so it isn't appended
  // to the first user message again on every subsequent call.
  const contextPrefix = contextBlock
    ? [
        { role: "user", content: contextBlock.trim() },
        { role: "assistant", content: "Got it — I have today's picks data. What would you like to know?" },
      ]
    : [];
  const fullMessages = [...contextPrefix, ...messages];

  try {
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 512,
      system: SYSTEM,
      messages: fullMessages,
    });

    const text = msg.content?.[0]?.text || "Sorry, I couldn't generate a response.";
    return Response.json({ reply: text });
  } catch (e) {
    console.error("Chat API error:", e);
    return Response.json({ error: "Failed to generate response" }, { status: 500 });
  }
}
