// Generates/revokes the public share link for a saved draft team
// (nfl_fantasy_draft_teams.share_token). Separate from the main
// draft-teams route since it's the one place an authenticated user hands out
// something an unauthenticated viewer can read — worth keeping its own
// small, obvious surface rather than folding a "make public" flag into the
// general PATCH body.
import { randomBytes } from "crypto";
import { createClient } from "@supabase/supabase-js";
import { requireAuth } from "../../../../../../lib/auth.js";

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function POST(request) {
  const { user, error } = await requireAuth(request);
  if (error) return error;

  const body = await request.json().catch(() => ({}));
  if (!body.id) return Response.json({ error: "id is required" }, { status: 400 });

  const supabase = getSupabase();
  const { data: existing, error: fetchErr } = await supabase
    .from("nfl_fantasy_draft_teams")
    .select("id, share_token").eq("id", body.id).eq("user_id", user.id).single();
  if (fetchErr || !existing) return Response.json({ error: "Draft not found" }, { status: 404 });

  // Reuse the existing token if one's already been issued — re-clicking
  // "Share" shouldn't invalidate a link someone already has open.
  const token = existing.share_token || randomBytes(16).toString("hex");
  if (!existing.share_token) {
    const { error: updateErr } = await supabase
      .from("nfl_fantasy_draft_teams")
      .update({ share_token: token }).eq("id", body.id);
    if (updateErr) return Response.json({ error: updateErr.message }, { status: 500 });
  }
  return Response.json({ shareToken: token });
}

export async function DELETE(request) {
  const { user, error } = await requireAuth(request);
  if (error) return error;

  const body = await request.json().catch(() => ({}));
  if (!body.id) return Response.json({ error: "id is required" }, { status: 400 });

  await getSupabase().from("nfl_fantasy_draft_teams")
    .update({ share_token: null }).eq("id", body.id).eq("user_id", user.id);
  return Response.json({ ok: true });
}
