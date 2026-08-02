// Private admin route — accepts an uploaded team personnel-usage screenshot,
// extracts structured per-team data via Claude's vision capability
// (lib/nfl-fantasy/personnel-extract.js), and stores it for
// lib/nfl-fantasy/personnel-adjustment.js to fold into rankings.
import { createClient } from "@supabase/supabase-js";
import { requireAuth } from "../../../../lib/auth.js";
import { extractPersonnelFromImage } from "../../../../lib/nfl-fantasy/personnel-extract.js";

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
    extracted = await extractPersonnelFromImage(imageBase64, mediaType || "image/jpeg");
  } catch (e) {
    return Response.json({ error: `extraction failed: ${e.message}` }, { status: 500 });
  }

  const rows = [];
  for (const team of extracted) {
    if (!team.team || !Number.isFinite(Number(team.wr3PlusPct)) || !Number.isFinite(Number(team.wr2MinusPct))) continue;
    rows.push({
      team: String(team.team).toUpperCase(),
      season: Number(season),
      wr3_plus_pct: Number(team.wr3PlusPct),
      wr2_minus_pct: Number(team.wr2MinusPct),
      source: source || null,
    });
  }
  if (!rows.length) {
    return Response.json({ error: "no usable rows extracted from image" }, { status: 422 });
  }

  const supabase = getSupabase();
  const { error } = await supabase
    .from("nfl_fantasy_team_personnel")
    .upsert(rows, { onConflict: "team,season" });
  if (error) return Response.json({ error: `upsert failed: ${error.message}` }, { status: 500 });

  return Response.json({ teamsExtracted: extracted.length, rowsStored: rows.length });
}
