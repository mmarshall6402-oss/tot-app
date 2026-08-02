// Extracts per-player weekly schedule-difficulty data from an uploaded
// screenshot via Claude's vision capability — the app already uses the
// Anthropic SDK for the Start/Sit/Trade chat (app/api/nfl/fantasy/route.js),
// same model, just a different prompt/input shape here.
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const EXTRACT_PROMPT = `This image shows a fantasy football schedule-difficulty grid, typically based on opponent run-defense strength (most relevant to running backs and rushing production). Each row is one player; each week column shows that week's opponent, shaded by matchup difficulty: red/pink background means a hard/tough matchup (strong run defense), green background means an easy/favorable matchup (weak run defense), gray means a BYE week, anything else counts as neutral.

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

difficulty must be exactly one of: "easy", "neutral", "hard", "bye". If a column header or section title names the position (e.g. "Running Back"), use that as the position for every player in that section.

Each player's "weeks" array must contain each week number at most once. Some grids have trailing summary/total columns after the last real week column (e.g. a repeated week number, a count, or a "Total" label) — these are not real matchups and must be skipped entirely, not emitted as an extra "weeks" entry.`;

export async function extractScheduleFromImage(base64Data, mediaType = "image/jpeg") {
  const msg = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 16000,
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
  try {
    return JSON.parse(jsonMatch[0]);
  } catch (e) {
    if (msg.stop_reason === "max_tokens") {
      throw new Error(`extraction was cut off at the token limit (image likely has too many rows) — try cropping the screenshot to fewer players and re-uploading: ${e.message}`);
    }
    throw new Error(`could not parse extracted JSON (near "${jsonMatch[0].slice(-120)}"): ${e.message}`);
  }
}
