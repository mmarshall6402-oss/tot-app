// Extracts per-team personnel-usage data (e.g. projected % of snaps in 3+ WR
// sets vs 2-or-fewer WR sets) from an uploaded screenshot via Claude's vision
// capability — same approach as lib/nfl-fantasy/schedule-extract.js, just a
// different table shape (one row per team, not per player-week).
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const EXTRACT_PROMPT = `This image shows a table of projected NFL team personnel/set usage — one row per team, with columns for the percentage of offensive snaps in "3+ WR sets" (three or more wide receivers on the field) and "2-or-fewer WR sets" (two or fewer wide receivers, implying heavier run/TE personnel).

Extract every row as JSON with exactly this shape and nothing else — no prose, no markdown fences, just the JSON array:
[
  { "team": "CLE", "wr3PlusPct": 40, "wr2MinusPct": 60 }
]

team must be the standard 2-3 letter NFL team abbreviation (e.g. "CLE", "SF", "LAC"). Percentages are numbers 0-100, not strings.`;

export async function extractPersonnelFromImage(base64Data, mediaType = "image/jpeg") {
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
  try {
    return JSON.parse(jsonMatch[0]);
  } catch (e) {
    if (msg.stop_reason === "max_tokens") {
      throw new Error(`extraction was cut off at the token limit (image likely has too many rows) — try cropping the screenshot to fewer teams and re-uploading: ${e.message}`);
    }
    throw new Error(`could not parse extracted JSON (near "${jsonMatch[0].slice(-120)}"): ${e.message}`);
  }
}
