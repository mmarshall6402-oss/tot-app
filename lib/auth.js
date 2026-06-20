import { createClient } from "@supabase/supabase-js";
import { createHmac, timingSafeEqual as cryptoTimingSafeEqual } from "crypto";

function decodeJwt(token) {
  try {
    const payload = token.split(".")[1];
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch { return null; }
}

// Verify HS256 JWT signature against SUPABASE_JWT_SECRET.
// Fails open if the secret is not configured (backwards compat).
function verifyJwtSignature(token) {
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) return true;
  const [header, payload, sig] = token.split(".");
  if (!header || !payload || !sig) return false;
  const expected = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  try {
    const a = Buffer.from(expected);
    const b = Buffer.from(sig);
    if (a.length !== b.length) return false;
    return cryptoTimingSafeEqual(a, b);
  } catch { return false; }
}

// In-process subscription cache — avoids a DB hit on every request.
// Vercel Fluid Compute reuses warm instances so this actually hits frequently.
const _subCache = new Map();
const SUB_TTL = 60 * 1000; // 1 minute — keeps cancellations effective quickly

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
  if (!verifyJwtSignature(token)) {
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

// Check if a user email is in the NEXT_PUBLIC_BETA_EMAILS list.
export function isBetaUser(email) {
  if (!email) return false;
  const betas = (process.env.NEXT_PUBLIC_BETA_EMAILS || "")
    .split(",").map(e => e.trim().toLowerCase()).filter(Boolean);
  return betas.includes(email.toLowerCase());
}

// Timing-safe secret comparison to prevent brute-force timing attacks.
export function timingSafeEqual(a, b) {
  if (!a || !b) return false;
  try {
    const ba = Buffer.from(String(a));
    const bb = Buffer.from(String(b));
    if (ba.length !== bb.length) return false;
    return cryptoTimingSafeEqual(ba, bb);
  } catch { return false; }
}
