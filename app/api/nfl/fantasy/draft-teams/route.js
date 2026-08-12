// CRUD for saved Draft Assistant snapshots (components/NFLSection.js "My
// Drafts" panel). Replaces localStorage-only persistence with an
// account-scoped save so a drafted team follows the user across devices and
// they can track more than one draft (e.g. two leagues) at once.
//
// GET    ?id=123         -> one team, full drafted_ids/my_ids (for loading into the tracker)
// GET     (no id)        -> list of the user's teams, summary fields only
// POST                   -> create a new saved team, returns its id
// PATCH                  -> update an existing team's name and/or snapshot (ownership-checked)
// DELETE ?id=123          -> delete a team (ownership-checked)
import { createClient } from "@supabase/supabase-js";
import { requireAuth } from "../../../../../lib/auth.js";

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const VALID_FORMATS = new Set(["ppr", "half_ppr", "standard"]);
const MAX_NAME_LEN = 60;
// A full draft board is well under this (a 12-team, 16-round draft is 192
// picks) — bounds the payload without getting in the way of a real draft.
const MAX_IDS = 1000;

function sanitizeIds(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((v) => typeof v === "string" && v.length > 0 && v.length < 100).slice(0, MAX_IDS);
}

export async function GET(request) {
  const { user, error } = await requireAuth(request);
  if (error) return error;

  const id = new URL(request.url).searchParams.get("id");
  const supabase = getSupabase();

  if (id) {
    const { data, error: dbErr } = await supabase
      .from("nfl_fantasy_draft_teams")
      .select("id, name, scoring_format, drafted_ids, my_ids, share_token, updated_at")
      .eq("id", id).eq("user_id", user.id).single();
    if (dbErr || !data) return Response.json({ error: "Draft not found" }, { status: 404 });
    return Response.json({ team: data });
  }

  const { data, error: dbErr } = await supabase
    .from("nfl_fantasy_draft_teams")
    .select("id, name, scoring_format, share_token, updated_at, my_ids")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false });
  if (dbErr) return Response.json({ error: dbErr.message }, { status: 500 });

  // my_ids' length is all the list view needs (a roster-size count next to
  // the name); the full array only matters once a team is actually loaded.
  const teams = (data || []).map(({ my_ids, ...rest }) => ({ ...rest, playerCount: Array.isArray(my_ids) ? my_ids.length : 0 }));
  return Response.json({ teams });
}

export async function POST(request) {
  const { user, error } = await requireAuth(request);
  if (error) return error;

  const body = await request.json().catch(() => ({}));
  const name = String(body.name || "My Team").slice(0, MAX_NAME_LEN);
  const scoringFormat = VALID_FORMATS.has(body.scoringFormat) ? body.scoringFormat : "ppr";
  const draftedIds = sanitizeIds(body.draftedIds);
  const myIds = sanitizeIds(body.myIds);

  const { data, error: dbErr } = await getSupabase()
    .from("nfl_fantasy_draft_teams")
    .insert({ user_id: user.id, name, scoring_format: scoringFormat, drafted_ids: draftedIds, my_ids: myIds })
    .select("id, name, scoring_format, updated_at")
    .single();
  if (dbErr) return Response.json({ error: dbErr.message }, { status: 500 });
  return Response.json({ team: data });
}

export async function PATCH(request) {
  const { user, error } = await requireAuth(request);
  if (error) return error;

  const body = await request.json().catch(() => ({}));
  if (!body.id) return Response.json({ error: "id is required" }, { status: 400 });

  const patch = { updated_at: new Date().toISOString() };
  if (body.name != null) patch.name = String(body.name).slice(0, MAX_NAME_LEN);
  if (body.draftedIds != null) patch.drafted_ids = sanitizeIds(body.draftedIds);
  if (body.myIds != null) patch.my_ids = sanitizeIds(body.myIds);

  const { data, error: dbErr } = await getSupabase()
    .from("nfl_fantasy_draft_teams")
    .update(patch)
    .eq("id", body.id).eq("user_id", user.id)
    .select("id, name, scoring_format, updated_at")
    .single();
  if (dbErr || !data) return Response.json({ error: "Draft not found" }, { status: 404 });
  return Response.json({ team: data });
}

export async function DELETE(request) {
  const { user, error } = await requireAuth(request);
  if (error) return error;

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id is required" }, { status: 400 });

  await getSupabase().from("nfl_fantasy_draft_teams").delete().eq("id", id).eq("user_id", user.id);
  return Response.json({ ok: true });
}
