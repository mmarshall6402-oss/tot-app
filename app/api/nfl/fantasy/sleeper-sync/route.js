// Account-scoped "what draft am I currently synced to" pointer for the
// Draft Assistant's Sleeper Sync mode (components/NFLSection.js). One row
// per user, silently upserted whenever the draft id or username changes —
// this is what lets opening the Draft tab on a second device (or after a
// refresh) resume the same live sync instead of asking the user to
// re-paste the draft link and re-type their username.
//
// GET    -> the caller's current sync (draftId/username/slot), all null if none set
// PUT     body {draftId, username, slot} -> upsert (any field can be null to clear it)
// DELETE  -> clear the caller's sync entirely (e.g. "Change Draft")
import { createClient } from "@supabase/supabase-js";
import { requireAuth } from "../../../../../lib/auth.js";

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function GET(request) {
  const { user, error } = await requireAuth(request);
  if (error) return error;

  const { data, error: dbErr } = await getSupabase()
    .from("nfl_fantasy_sleeper_sync")
    .select("draft_id, username, slot")
    .eq("user_id", user.id)
    .maybeSingle();
  if (dbErr) return Response.json({ error: dbErr.message }, { status: 500 });

  return Response.json({
    draftId: data?.draft_id || null,
    username: data?.username || null,
    slot: data?.slot ?? null,
  });
}

export async function PUT(request) {
  const { user, error } = await requireAuth(request);
  if (error) return error;

  const body = await request.json().catch(() => ({}));
  const draftId = body.draftId ? String(body.draftId).slice(0, 100) : null;
  const username = body.username ? String(body.username).slice(0, 100) : null;
  const slot = Number.isFinite(body.slot) ? body.slot : null;

  const { error: dbErr } = await getSupabase()
    .from("nfl_fantasy_sleeper_sync")
    .upsert({ user_id: user.id, draft_id: draftId, username, slot, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (dbErr) return Response.json({ error: dbErr.message }, { status: 500 });

  return Response.json({ ok: true });
}

export async function DELETE(request) {
  const { user, error } = await requireAuth(request);
  if (error) return error;

  await getSupabase().from("nfl_fantasy_sleeper_sync").delete().eq("user_id", user.id);
  return Response.json({ ok: true });
}
