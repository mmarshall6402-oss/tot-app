// Private admin route — accepts an uploaded schedule-difficulty screenshot,
// extracts structured per-player weekly data via Claude's vision capability
// (lib/nfl-fantasy/schedule-extract.js), and stores it for
// lib/nfl-fantasy/schedule-adjustment.js to fold into rankings.
import { createClient } from "@supabase/supabase-js";
import { requireAuth } from "../../../../lib/auth.js";
import { extractScheduleFromImage } from "../../../../lib/nfl-fantasy/schedule-extract.js";

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkAuth(request) {
  const { user } = await requireAuth(request);
  if (!user) return false;
  const admins = (process.env.NEXT_PUBLIC_ADMIN_EMAILS || process.env.NEXT_PUBLIC_ADMIN_EMAIL || "")
    .split(",").map(e => e.trim().toLowerCase()).filter(Boolean);
  return admins.includes(user.email?.toLowerCase());
}

export async function POST(request) {
  if (!await checkAuth(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const { imageBase64, mediaType, season, source } = body;
  if (!imageBase64 || !season) {
    return Response.json({ error: "imageBase64 and season are required" }, { status: 400 });
  }

  let extracted;
  try {
    extracted = await extractScheduleFromImage(imageBase64, mediaType || "image/jpeg");
  } catch (e) {
    return Response.json({ error: `extraction failed: ${e.message}` }, { status: 500 });
  }

  // Keyed by player_name+season+week (the upsert's conflict target) — a Map
  // dedupes any repeated week columns the vision extraction may have echoed
  // (e.g. a trailing summary column), since Postgres rejects an upsert batch
  // that targets the same conflict key twice, aborting the whole batch.
  const rowsByKey = new Map();
  for (const player of extracted) {
    for (const w of player.weeks || []) {
      if (!w.week || !w.difficulty) continue;
      const key = `${player.name}|${season}|${w.week}`;
      rowsByKey.set(key, {
        player_name: player.name,
        position: player.position || null,
        season: Number(season),
        week: Number(w.week),
        opponent: w.opponent || null,
        difficulty: w.difficulty,
        source: source || null,
      });
    }
  }
  const rows = [...rowsByKey.values()];
  if (!rows.length) {
    return Response.json({ error: "no usable rows extracted from image" }, { status: 422 });
  }

  const supabase = getSupabase();
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await supabase
      .from("nfl_fantasy_schedule_difficulty")
      .upsert(rows.slice(i, i + CHUNK), { onConflict: "player_name,season,week" });
    if (error) return Response.json({ error: `upsert failed: ${error.message}` }, { status: 500 });
  }

  return Response.json({ playersExtracted: extracted.length, rowsStored: rows.length });
}
