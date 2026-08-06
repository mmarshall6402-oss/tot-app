import { requireAuth, requireFantasyCallAllowance } from "../../../../lib/auth.js";
import { lookupNFLPlayer, formatNFLPlayerContext, findMentionedNFLPlayers } from "../../../../lib/nfl-roster.js";
import { rankingsContextLine } from "../../../../lib/nfl-fantasy/lookup.js";
import { propLineForPlayer, formatPropLine } from "../../../../lib/nfl-fantasy/prop-line.js";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Resolves one player to { text, propLine, name }: text is what Claude reads
// (VORP/projection grounding + a formatted prop line, or an explicit
// "not posted yet" note — never silence, since an absent field reads as
// "nothing to say" and gets filled from the model's priors); propLine is
// the structured market-prop object (or null) that the API response hands
// straight to the client, so the actual digits the user sees always come
// from our own data, never from anything Claude wrote.
async function playerContextAndProp(p, scoring) {
  if (!p) return { text: null, propLine: null, name: null };
  const [rankingLine, propLine] = await Promise.all([
    rankingsContextLine(p, scoring).catch(() => null),
    propLineForPlayer(p).catch(() => null),
  ]);
  const base = rankingLine || formatNFLPlayerContext(p);
  const propText = formatPropLine(propLine) ||
    "Market prop: NOT POSTED — books have not released this line yet for this player.";
  return { text: base ? `${base}\n${propText}` : null, propLine, name: p.name || null };
}

// A player picked from the /api/search-backed typeahead (components/NFLSection.js's
// PlayerSearchInput) arrives as the exact {id, name, team, position} row instead of
// free text — skip the fuzzy roster-name match entirely and go straight to
// grounding, since there's no ambiguity left to resolve.
function isResolvedPlayer(info) {
  return !!(info && typeof info.name === "string" && info.name.trim());
}

// Free-text fallback (user typed a name without picking a typeahead result).
// Can technically hold multiple comma-separated names; the structured
// propLine on the returned bundle is the first resolved player's, matching
// the single-player-per-field shape the UI actually presents.
async function playerContextBlock(namesField, scoring) {
  const names = (namesField || "").split(",").map(n => n.trim()).filter(Boolean);
  if (!names.length) return { text: null, propLine: null, name: null };
  const players = await Promise.all(names.map(n => lookupNFLPlayer(n)));
  const bundles = await Promise.all(players.map(p => playerContextAndProp(p, scoring)));
  const text = bundles.map(b => b.text).filter(Boolean).join("\n") || null;
  const firstResolved = bundles.find(b => b.name);
  return { text, propLine: firstResolved?.propLine ?? null, name: firstResolved?.name || names[0] };
}

async function playerContext(namesField, info, scoring) {
  return isResolvedPlayer(info) ? playerContextAndProp(info, scoring) : playerContextBlock(namesField, scoring);
}

const GROUNDING_RULES = `If current roster/injury data is provided in the message, treat it as more reliable than your own training knowledge (rosters and injury designations change constantly) — lead with it when it's decisive. If a line includes VORP/projection/tier numbers, treat those as ground truth over your own training-knowledge point estimates — reserve your own knowledge for qualitative narrative (matchup, scheme fit, recent news) rather than re-deriving a point total.

Never write a specific sportsbook prop number anywhere in your output, even if the data below gives you one — that number is rendered directly from our own data elsewhere in the app, so restating it yourself only risks transcribing it wrong. When comparing to the market, describe the DIRECTION only: whether the market's number reads higher than, lower than, or in line with our own projection. If a player's line says "NOT POSTED," do not mention a market prop for that player at all — not from memory, not an estimate, not a typical range. Books frequently haven't posted player props yet early in the week (most Start/Sit traffic happens Tuesday-Thursday, before lines go up) — that's the default state, not an edge case, so lean on VORP, matchup, and usage data to make the case instead. This overrides your own training knowledge of typical prop lines entirely.`;

const VERDICT_TOOL = {
  name: "fantasy_verdict",
  description: "A structured start/sit or trade verdict.",
  input_schema: {
    type: "object",
    properties: {
      verdict: { type: "string", description: "Short, decisive verdict, e.g. 'START Justin Jefferson' or 'ACCEPT the trade'. No hedging." },
      bullets: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 3, description: "1-3 one-sentence reasons." },
      marketNote: { type: "string", description: "One sentence on how the market's prop number compares to our projection, DIRECTION only (higher/lower/in line) — never the number itself. Empty string if no market line is available for either player." },
      confidence: { type: "string", description: "One short confidence note." },
    },
    required: ["verdict", "bullets", "confidence", "marketNote"],
  },
};

const SYSTEM_STRUCTURED = `You are a sharp fantasy football analyst. You give direct, confident starts/sits verdicts and trade analysis via the fantasy_verdict tool — no hedging, no "it depends on your league," just a clear recommendation with the key reasons.

${GROUNDING_RULES}

For starts/sits: consider target share, snap count trends, matchup grade, scoring format, injury status, and recent usage. Give the better play clearly.

For trade analysis: evaluate both sides by projected points, positional scarcity, roster construction context, and rest-of-season outlook.`;

const SYSTEM_ASK = `You are a sharp fantasy football analyst. You give direct, confident answers — no hedging, no "it depends on your league."

Format your response for mobile: 2-4 short sentences or bullets, no more.

${GROUNDING_RULES}

Keep responses under 120 words. Be decisive.`;

// Belt-and-suspenders (Layer 3): if NEITHER player in the request has a real
// posted market line, any sentence that pairs a decimal number with a
// prop-ish keyword is definitionally fabricated — the model had no real
// number to draw from. Strip it and log rather than trust prompt compliance
// alone. Left alone whenever at least one real line exists, since at that
// point a false positive (dropping a legitimate VORP/projection number) is
// more likely than a real catch.
const PROP_MENTION_RE = /(\breception|\breceiving|\brushing|\bpassing|\byard|\bprop\b|\bo\/u\b|\bover.under|\bline\b|\bbook\b|\bvegas\b|\bmarket\b)[^.?!]{0,40}?\d+(\.\d+)?|\d+(\.\d+)?[^.?!]{0,40}?(\breception|\breceiving|\brushing|\bpassing|\byard|\bprop\b|\bo\/u\b|\bover.under|\bline\b|\bbook\b|\bvegas\b|\bmarket\b)/i;

function stripInvented(text, tag) {
  if (!text) return text;
  const sentences = text.split(/(?<=[.!?])\s+/);
  const kept = sentences.filter(s => {
    const bad = PROP_MENTION_RE.test(s);
    if (bad) console.warn(`[nfl-fantasy] stripped invented prop mention (${tag}):`, s);
    return !bad;
  });
  return kept.join(" ").trim();
}

function sanitizeVerdict(v, anyRealLine) {
  if (anyRealLine) return v; // at least one real line exists — trust the prompt, don't blanket-strip
  return {
    verdict: v.verdict, // headline is never sentence-stripped — always needed for the UI
    bullets: (v.bullets || []).map(b => stripInvented(b, "bullets")).filter(Boolean),
    marketNote: stripInvented(v.marketNote, "marketNote") || "",
    confidence: stripInvented(v.confidence, "confidence") || v.confidence,
  };
}

async function getStructuredVerdict(userMessage) {
  const msg = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 400,
    system: SYSTEM_STRUCTURED,
    messages: [{ role: "user", content: userMessage }],
    tools: [VERDICT_TOOL],
    tool_choice: { type: "tool", name: "fantasy_verdict" },
  });
  const toolUse = msg.content.find(c => c.type === "tool_use");
  if (!toolUse) throw new Error("model did not return a structured verdict");
  return toolUse.input;
}

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

  try {
    if (mode === "startSit") {
      if (!playerA || !playerB) return Response.json({ error: "playerA and playerB required" }, { status: 400 });
      const [a, b] = await Promise.all([playerContext(playerA, playerAInfo, scoring), playerContext(playerB, playerBInfo, scoring)]);
      const context = [a.text, b.text].filter(Boolean).join("\n");
      const userMessage = `Scoring format: ${scoring || "PPR"}\n\n` +
        (context ? `Current roster/injury/projection data:\n${context}\n\n` : "") +
        `Should I start ${playerA} or ${playerB} this week? Give me a clear start/sit verdict.`;

      const anyRealLine = !!(a.propLine || b.propLine);
      const raw = await getStructuredVerdict(userMessage);
      const verdict = sanitizeVerdict(raw, anyRealLine);

      return Response.json({
        result: {
          ...verdict,
          players: [
            { name: a.name || playerA, propLine: a.propLine },
            { name: b.name || playerB, propLine: b.propLine },
          ],
        },
      });
    }

    if (mode === "trade") {
      if (!tradeGive || !tradeGet) return Response.json({ error: "tradeGive and tradeGet required" }, { status: 400 });
      const [give, get] = await Promise.all([playerContext(tradeGive, tradeGiveInfo, scoring), playerContext(tradeGet, tradeGetInfo, scoring)]);
      const context = [give.text, get.text].filter(Boolean).join("\n");
      const userMessage = `Scoring format: ${scoring || "PPR"}\n\n` +
        (context ? `Current roster/injury/projection data:\n${context}\n\n` : "") +
        `Trade analysis: I'm giving ${tradeGive} and receiving ${tradeGet}. Should I accept or decline?`;

      const anyRealLine = !!(give.propLine || get.propLine);
      const raw = await getStructuredVerdict(userMessage);
      const verdict = sanitizeVerdict(raw, anyRealLine);

      return Response.json({
        result: {
          ...verdict,
          players: [
            { name: give.name || tradeGive, propLine: give.propLine },
            { name: get.name || tradeGet, propLine: get.propLine },
          ],
        },
      });
    }

    if (mode === "ask") {
      if (!question) return Response.json({ error: "question required" }, { status: 400 });
      const mentioned = await findMentionedNFLPlayers(question).catch(() => []);
      const bundles = await Promise.all(mentioned.map(p => playerContextAndProp(p, scoring)));
      const context = bundles.map(b => b.text).filter(Boolean).join("\n");
      const anyRealLine = bundles.some(b => b.propLine);
      const userMessage = `Scoring format: ${scoring || "PPR"}\n\n` +
        (context ? `Current roster/injury/projection data for players mentioned below:\n${context}\n\n` : "") +
        question;

      const msg = await anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 300,
        system: SYSTEM_ASK,
        messages: [{ role: "user", content: userMessage }],
      });
      const text = msg.content[0]?.text || "";
      return Response.json({ result: anyRealLine ? text : stripInvented(text, "ask") });
    }

    return Response.json({ error: "mode must be startSit, trade, or ask" }, { status: 400 });
  } catch (e) {
    console.error("NFL fantasy API error", e);
    return Response.json({ error: "AI error" }, { status: 500 });
  }
}
