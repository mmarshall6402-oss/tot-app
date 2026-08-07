// Private admin route — accepts a pasted consensus-ADP list (plain text or
// CSV, copied from any public source), parses it with
// lib/nfl-fantasy/adp-extract.js, and stores it for
// lib/nfl-fantasy/adp-compare.js to join into rankings. No external fetch or
// vision call here — same "cheap" spirit as the feature itself.
import { createClient } from "@supabase/supabase-js";
import { requireAuth } from "../../../../lib/auth.js";
import { parseAdpText } from "../../../../lib/nfl-fantasy/adp-extract.js";

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
  const { text, season, source } = body;
  if (!text || !season) {
    return Response.json({ error: "text and season are required" }, { status: 400 });
  }

  const parsed = parseAdpText(text);
  if (!parsed.length) {
    return Response.json({ error: "no usable rows parsed from pasted text" }, { status: 422 });
  }

  // Keyed by name+season (the upsert's conflict target) — dedupes any
  // repeated name the pasted list may contain, since Postgres rejects an
  // upsert batch that targets the same conflict key twice, aborting the
  // whole batch.
  const rowsByKey = new Map();
  for (const row of parsed) {
    const key = `${row.name.toLowerCase()}|${season}`;
    rowsByKey.set(key, {
      name: row.name,
      position: row.position || null,
      team: row.team || null,
      adp: row.adp,
      season: Number(season),
      source: source || null,
    });
  }
  const rows = [...rowsByKey.values()];

  const supabase = getSupabase();
  const runStart = new Date().toISOString();
  const rowsWithTimestamp = rows.map((r) => ({ ...r, updated_at: runStart }));

  const { error } = await supabase
    .from("nfl_fantasy_adp")
    .upsert(rowsWithTimestamp, { onConflict: "name,season" });
  if (error) return Response.json({ error: `upsert failed: ${error.message}` }, { status: 500 });

  // A paste is a full refresh of that season's ADP board — drop anything
  // this run didn't touch, same stale-row cleanup as the rankings cron.
  await supabase
    .from("nfl_fantasy_adp")
    .delete()
    .eq("season", Number(season))
    .lt("updated_at", runStart);

  return Response.json({ rowsParsed: parsed.length, rowsStored: rows.length });
}
