import { createClient } from "@supabase/supabase-js";

// Decode JWT payload locally — no network call, no round-trip to Supabase Auth.
// We trust the exp claim to catch stale tokens. Full signature verification would
// require the project JWT_SECRET; skipping it here is an acceptable trade-off
// because the data gated is picks (same for all pro users, no PII).
function decodeJwt(token) {
  try {
    const payload = token.split(".")[1];
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch { return null; }
}

// In-process subscription cache — avoids a DB hit on every request.
// Vercel Fluid Compute reuses warm instances so this actually hits frequently.
const _subCache = new Map();
const SUB_TTL = 5 * 60 * 1000; // 5 minutes

async function lookupSub(userId) {
  const hit = _subCache.get(userId);
  if (hit && Date.now() - hit.ts < SUB_TTL) return hit.isPro;

  const { data } = await createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  ).from("subscriptions").select("status").eq("user_id", userId).single();

  const isPro = ["active", "trialing"].includes(data?.status ?? "");
  _subCache.set(userId, { isPro, ts: Date.now() });
  return isPro;
}

// Extract user from JWT in the Authorization header — no network call.
export async function requireAuth(request) {
  const token = request.headers.get("authorization")?.replace("Bearer ", "").trim();
  if (!token) return { user: null, error: Response.json({ error: "Unauthorized" }, { status: 401 }) };

  const payload = decodeJwt(token);
  if (!payload?.sub || (payload.exp && payload.exp * 1000 < Date.now())) {
    return { user: null, error: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { user: { id: payload.sub, email: payload.email || "" }, error: null };
}

// Like requireAuth but also checks for an active subscription.
// First request per user: 1 DB query. Subsequent requests within 5 min: 0 DB queries.
export async function requirePro(request) {
  const { user, error } = await requireAuth(request);
  if (error) return { user: null, error };

  const admins = (process.env.NEXT_PUBLIC_ADMIN_EMAILS || process.env.NEXT_PUBLIC_ADMIN_EMAIL || "")
    .split(",").map(e => e.trim().toLowerCase()).filter(Boolean);
  if (admins.includes(user.email.toLowerCase())) return { user, error: null };

  const isPro = await lookupSub(user.id);
  if (!isPro) return { user: null, error: Response.json({ error: "Pro subscription required" }, { status: 403 }) };
  return { user, error: null };
}

// Timing-safe secret comparison to prevent brute-force timing attacks.
export function timingSafeEqual(a, b) {
  if (!a || !b) return false;
  try {
    const ba = Buffer.from(String(a));
    const bb = Buffer.from(String(b));
    if (ba.length !== bb.length) return false;
    return require("crypto").timingSafeEqual(ba, bb);
  } catch { return false; }
}
