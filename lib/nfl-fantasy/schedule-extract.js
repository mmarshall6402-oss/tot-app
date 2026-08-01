// Extracts per-player weekly schedule-difficulty data from an uploaded
// screenshot via Claude's vision capability — the app already uses the
// Anthropic SDK for the Start/Sit/Trade chat (app/api/nfl/fantasy/route.js),
// same model, just a different prompt/input shape here.
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const EXTRACT_PROMPT = `This image shows a fantasy football schedule-difficulty grid. Each row is one player; each week column shows that week's opponent, shaded by matchup difficulty: red/pink background means a hard/tough matchup, green background means an easy/favorable matchup, gray means a BYE week, anything else counts as neutral.

Extract every row as JSON with exactly this shape and nothing else — no prose, no markdown fences, just the JSON array:
[
  {
    "name": "Player Name",
    "position": "RB",
    "weeks": [
      { "week": 1, "opponent": "HOU", "difficulty": "hard" }
    ]
  }
]

difficulty must be exactly one of: "easy", "neutral", "hard", "bye". If a column header or section title names the position (e.g. "Running Back"), use that as the position for every player in that section.`;

export async function extractScheduleFromImage(base64Data, mediaType = "image/jpeg") {
  const msg = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 8000,
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: mediaType, data: base64Data } },
        { type: "text", text: EXTRACT_PROMPT },
      ],
    }],
  });
  const text = msg.content[0]?.text || "";
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error("Claude did not return parseable JSON from the image");
  return JSON.parse(jsonMatch[0]);
}
