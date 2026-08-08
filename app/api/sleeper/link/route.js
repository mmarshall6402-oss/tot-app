// Link/unlink the caller's Sleeper identity by username. Sleeper has no
// OAuth — usernames are public and the lookup endpoint is unauthenticated —
// so "linking" just means looking up the username once and remembering the
// resulting sleeper_user_id against our own user.
import { createClient } from "@supabase/supabase-js";
import { requireAuth } from "../../../../lib/auth.js";
import { fetchSleeperUserByUsername } from "../../../../lib/nfl-fantasy/sleeper.js";

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function GET(request) {
  const { user, error: authError } = await requireAuth(request);
  if (authError) return authError;

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("sleeper_links")
    .select("sleeper_user_id, sleeper_username, display_name, avatar, linked_at")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ linked: !!data, link: data || null });
}

export async function POST(request) {
  const { user, error: authError } = await requireAuth(request);
  if (authError) return authError;

  let body;
  try { body = await request.json(); } catch { body = {}; }
  const username = (body?.username || "").trim();
  if (!username) return Response.json({ error: "username is required" }, { status: 400 });

  let sleeperUser;
  try {
    sleeperUser = await fetchSleeperUserByUsername(username);
  } catch (e) {
    return Response.json({ error: `Sleeper lookup failed: ${e.message}` }, { status: 502 });
  }
  if (!sleeperUser) {
    return Response.json({ error: `No Sleeper user found for "${username}"` }, { status: 404 });
  }

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("sleeper_links")
    .upsert({
      user_id: user.id,
      sleeper_user_id: sleeperUser.sleeperUserId,
      sleeper_username: sleeperUser.username,
      display_name: sleeperUser.displayName,
      avatar: sleeperUser.avatar,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" })
    .select("sleeper_user_id, sleeper_username, display_name, avatar, linked_at")
    .single();
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ linked: true, link: data });
}

export async function DELETE(request) {
  const { user, error: authError } = await requireAuth(request);
  if (authError) return authError;

  const supabase = getSupabase();
  await supabase.from("sleeper_league_selections").delete().eq("user_id", user.id);
  const { error } = await supabase.from("sleeper_links").delete().eq("user_id", user.id);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ ok: true });
}
