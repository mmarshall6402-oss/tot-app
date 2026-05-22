import { createClient } from "@supabase/supabase-js";
import { requireAuth } from "../../../../lib/auth.js";

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function isAdmin(user) {
  const admins = (process.env.NEXT_PUBLIC_ADMIN_EMAILS || process.env.NEXT_PUBLIC_ADMIN_EMAIL || "")
    .split(",").map(e => e.trim().toLowerCase()).filter(Boolean);
  return admins.includes(user.email?.toLowerCase());
}

function randCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

export async function GET(request) {
  const { user, error } = await requireAuth(request);
  if (error) return error;
  if (!isAdmin(user)) return Response.json({ error: "Forbidden" }, { status: 403 });

  const { data } = await getSupabase().from("access_codes").select("*").order("created_at", { ascending: false });
  return Response.json({ codes: data || [] });
}

export async function POST(request) {
  const { user, error } = await requireAuth(request);
  if (error) return error;
  if (!isAdmin(user)) return Response.json({ error: "Forbidden" }, { status: 403 });

  const { label, uses_max, expires_at } = await request.json();
  // Generate unique code
  let code, attempts = 0;
  const supabase = getSupabase();
  do {
    code = randCode();
    const { data } = await supabase.from("access_codes").select("id").eq("code", code).single();
    if (!data) break;
  } while (++attempts < 10);

  const { data, error: dbErr } = await supabase.from("access_codes").insert({
    code,
    label: label || null,
    uses_max: uses_max || null,
    expires_at: expires_at || null,
  }).select().single();

  if (dbErr) return Response.json({ error: dbErr.message }, { status: 500 });
  return Response.json({ code: data.code, id: data.id });
}

export async function DELETE(request) {
  const { user, error } = await requireAuth(request);
  if (error) return error;
  if (!isAdmin(user)) return Response.json({ error: "Forbidden" }, { status: 403 });

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id required" }, { status: 400 });

  await getSupabase().from("access_codes").delete().eq("id", id);
  return Response.json({ ok: true });
}
