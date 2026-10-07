// Extracts structured data from an uploaded bet-slip screenshot (sportsbook
// or Kalshi ticket) via Claude's vision capability — same model and
// image-input shape as lib/nfl-fantasy/personnel-extract.js, but using a
// forced tool call instead of prose-then-regex, since the shape here is
// richer (nested legs) and worth a real schema.
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const TOOL_NAME = "record_bet_slip";

const TOOL = {
  name: TOOL_NAME,
  description: "Record the structured contents of a sportsbook or prediction-market (e.g. Kalshi) bet slip / ticket screenshot.",
  input_schema: {
    type: "object",
    properties: {
      is_bet_slip: { type: "boolean", description: "true only if the image is actually a sportsbook or prediction-market bet slip/ticket confirmation; false for anything else (a random photo, a different kind of screenshot, an unreadable image, etc.)" },
      book: { type: "string", description: "The sportsbook or platform name exactly as shown, e.g. DraftKings, FanDuel, BetMGM, Kalshi" },
      ticket_id: { type: "string", description: "The slip/ticket/bet ID or confirmation number printed on the slip, exactly as shown" },
      stake: { type: "number", description: "Amount wagered, in dollars, as a plain number (no currency symbol)" },
      max_payout: { type: "number", description: "Total potential payout if every leg wins, in dollars, as a plain number" },
      placed_at: {
        type: ["string", "null"],
        description: "When the bet was placed, as an ISO-8601 timestamp including a UTC offset (e.g. \"2025-01-15T14:30:00-06:00\"). The user's timezone and current UTC offset will be given to you in the prompt — use that offset when the slip shows a date/time without its own timezone. Use null if no placed date/time is visible or it can't be confidently parsed.",
      },
      legs: {
        type: "array",
        description: "Every individual selection on the slip — one entry even for a single straight bet.",
        items: {
          type: "object",
          properties: {
            sport: { type: "string", description: "Sport or market category, e.g. NFL, NBA, MLB, NHL, Soccer, or the Kalshi market category (e.g. Economics, Politics)" },
            pick: { type: "string", description: "The specific selection as printed, e.g. \"Chiefs -3.5\", \"Over 220.5\", \"Lakers ML\", \"Fed holds rates in March\"" },
            implied_prob: { type: "number", description: "This leg's implied win probability, either read directly if the slip shows one, or converted from American/decimal odds. Return it as a plain number — either a fraction between 0 and 1, or a percentage between 0 and 100 (either is fine, it gets normalized after)." },
          },
          required: ["pick"],
        },
      },
    },
    required: ["is_bet_slip", "legs"],
  },
};

// Accepts either a 0-1 fraction or a 0-100 percentage from the model and
// normalizes to a 0-1 fraction, since models are inconsistent about which
// one they return despite the schema description.
function normalizeProb(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const frac = n > 1 ? n / 100 : n;
  return Math.max(0, Math.min(1, frac));
}

function normalizeNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// "GMT-06:00" -> "-06:00"; bare "GMT" (UTC) -> "+00:00".
function utcOffsetString(timeZone, at = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" }).formatToParts(at);
    const tzName = parts.find(p => p.type === "timeZoneName")?.value || "GMT";
    const m = tzName.match(/GMT([+-]\d{2}:\d{2})?/);
    return m?.[1] || "+00:00";
  } catch {
    return "+00:00";
  }
}

export async function parseBetSlip(base64Data, mediaType, timezone) {
  const tz = timezone || "UTC";
  const offset = utcOffsetString(tz);

  let msg;
  try {
    msg = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      tools: [TOOL],
      tool_choice: { type: "tool", name: TOOL_NAME },
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: base64Data } },
          { type: "text", text: `Extract this bet slip. The user's timezone is ${tz}, currently at UTC offset ${offset} — use that offset for placed_at if the slip shows a date/time without its own timezone.` },
        ],
      }],
    });
  } catch (e) {
    throw new Error(`Claude vision call failed: ${e.message}`);
  }

  const toolUse = msg.content?.find(b => b.type === "tool_use" && b.name === TOOL_NAME);
  if (!toolUse) throw new Error("Claude did not return a structured extraction for this image");
  const data = toolUse.input || {};

  const legs = (Array.isArray(data.legs) ? data.legs : [])
    .filter(l => l && typeof l.pick === "string" && l.pick.trim())
    .map(l => ({
      sport: typeof l.sport === "string" && l.sport.trim() ? l.sport.trim() : null,
      pick: l.pick.trim(),
      implied_prob: normalizeProb(l.implied_prob),
    }));

  let placedAt = null;
  if (typeof data.placed_at === "string" && data.placed_at.trim()) {
    const d = new Date(data.placed_at);
    if (!Number.isNaN(d.getTime())) placedAt = d.toISOString();
  }

  return {
    is_bet_slip: !!data.is_bet_slip,
    book: typeof data.book === "string" && data.book.trim() ? data.book.trim() : null,
    ticket_id: typeof data.ticket_id === "string" && data.ticket_id.trim() ? data.ticket_id.trim() : null,
    stake: normalizeNumber(data.stake),
    max_payout: normalizeNumber(data.max_payout),
    placed_at: placedAt,
    legs,
  };
}
