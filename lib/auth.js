import { createClient } from "@supabase/supabase-js";

// Verify a Supabase JWT from the Authorization header.
// Returns { user, error } — if error is set, return it immediately.
export async function requireAuth(request) {
  const token = request.headers.get("authorization")?.replace("Bearer ", "").trim();
  if (!token) return { user: null, error: Response.json({ error: "Unauthorized" }, { status: 401 }) };

  const { data: { user }, error } = await createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ).auth.getUser(token);

  if (error || !user) return { user: null, error: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  return { user, error: null };
}

// Like requireAuth but also checks the user has an active subscription.
// Admin emails bypass the subscription check.
export async function requirePro(request) {
  const { user, error } = await requireAuth(request);
  if (error) return { user: null, error };

  const admins = (process.env.NEXT_PUBLIC_ADMIN_EMAILS || process.env.NEXT_PUBLIC_ADMIN_EMAIL || "")
    .split(",").map(e => e.trim().toLowerCase()).filter(Boolean);
  if (admins.includes(user.email?.toLowerCase())) return { user, error: null };

  const { data } = await createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  ).from("subscriptions").select("status").eq("user_id", user.id).single();

  if (!["active", "trialing"].includes(data?.status ?? "")) {
    return { user, error: Response.json({ error: "Pro subscription required" }, { status: 403 }) };
  }
  return { user, error: null };
}

// Timing-safe secret comparison to prevent brute-force timing attacks.
export function timingSafeEqual(a, b) {
  if (!a || !b) return false;
  try {
    const ba = Buffer.from(String(a));
    const bb = Buffer.from(String(b));
    if (ba.length !== bb.length) {
      // Still compare to avoid length-based timing leak
      Buffer.from(String(a)).every((_, i) => String(a)[i] === String(b)[i % b.length]);
      return false;
    }
    return require("crypto").timingSafeEqual(ba, bb);
  } catch { return false; }
}
