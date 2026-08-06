import { createClient } from "@supabase/supabase-js";
import { createHmac, timingSafeEqual as cryptoTimingSafeEqual } from "crypto";

function decodeJwt(token) {
  try {
    const payload = token.split(".")[1];
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch { return null; }
}

// Verify HS256 JWT signature against SUPABASE_JWT_SECRET.
// If the secret isn't configured, fall back to asking Supabase's Auth API to
// validate the token directly — slower (a network call) but never trusts an
// unverified token, unlike the previous "fails open" behavior.
async function verifyJwtSignature(token) {
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) {
    try {
      const { data, error } = await createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      ).auth.getUser(token);
      return !error && !!data?.user;
    } catch { return false; }
  }
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

  // createClient throws synchronously on a missing key, which (uncaught) crashes
  // the whole function invocation — Vercel then serves an HTML error page and the
  // client sees "Unexpected token '<'" instead of a diagnosable message.
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY env var is not set");
  }
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
  if (!(await verifyJwtSignature(token))) {
    return { user: null, error: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { user: { id: payload.sub, email: payload.email || "" }, error: null };
}

function isAdminEmail(email) {
  const admins = (process.env.NEXT_PUBLIC_ADMIN_EMAILS || process.env.NEXT_PUBLIC_ADMIN_EMAIL || "")
    .split(",").map(e => e.trim().toLowerCase()).filter(Boolean);
  return admins.includes((email || "").toLowerCase());
}

// Like requireAuth but also checks for an active subscription.
// First request per user: 1 DB query. Subsequent requests within 5 min: 0 DB queries.
export async function requirePro(request) {
  const { user, error } = await requireAuth(request);
  if (error) return { user: null, error };

  if (isAdminEmail(user.email)) return { user, error: null };

  // Never let the subscription check throw: requirePro is called before each
  // route's try/catch, so an exception here escapes as a platform-level crash
  // (HTML error page) rather than a JSON error the client can display.
  let isPro;
  try {
    isPro = await lookupSub(user.id);
  } catch (e) {
    return { user: null, error: Response.json({ error: `Subscription check failed: ${e.message}` }, { status: 500 }) };
  }
  if (!isPro) return { user: null, error: Response.json({ error: "Pro subscription required" }, { status: 403 }) };
  return { user, error: null };
}

// Free plan's weekly Start/Sit allowance (see sql/017_fantasy_free_usage.sql).
const FREE_STARTSIT_WEEKLY_LIMIT = 3;

// Monday (America/Chicago) of the current week, as YYYY-MM-DD — the fantasy
// week rolls over on Monday morning same as real NFL matchups.
function weekStartDate(now = new Date()) {
  const ctParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit", weekday: "short",
  }).formatToParts(now);
  const get = (t) => ctParts.find(p => p.type === t).value;
  const dow = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }[get("weekday")];
  const today = new Date(Date.UTC(Number(get("year")), Number(get("month")) - 1, Number(get("day"))));
  today.setUTCDate(today.getUTCDate() - dow);
  return today.toISOString().slice(0, 10);
}

// Gates Start/Sit calls to 3/week for free users; Pro and admin users are
// unlimited. Like requirePro, this never throws — a DB hiccup here degrades
// to "allow the call" rather than crashing or wrongly blocking a paying-
// adjacent free user, since the downside of one extra free call is much
// smaller than the downside of a broken feature.
export async function requireFantasyCallAllowance(request) {
  const { user, error } = await requireAuth(request);
  if (error) return { user: null, error };

  if (isAdminEmail(user.email)) return { user, error: null };

  let isPro;
  try {
    isPro = await lookupSub(user.id);
  } catch {
    isPro = false;
  }
  if (isPro) return { user, error: null };

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { user, error: null };

  try {
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const weekStart = weekStartDate();
    const { data } = await supabase
      .from("fantasy_free_usage")
      .select("call_count")
      .eq("user_id", user.id).eq("week_start", weekStart).single();

    const used = data?.call_count || 0;
    if (used >= FREE_STARTSIT_WEEKLY_LIMIT) {
      return {
        user: null,
        error: Response.json({
          error: `Free plan includes ${FREE_STARTSIT_WEEKLY_LIMIT} Start/Sit calls per week — you've used them all. Resets Monday, or go Pro for unlimited calls plus the prop-line comparison.`,
        }, { status: 403 }),
      };
    }

    await supabase.from("fantasy_free_usage")
      .upsert({ user_id: user.id, week_start: weekStart, call_count: used + 1, updated_at: new Date().toISOString() }, { onConflict: "user_id,week_start" });
  } catch (e) {
    console.warn("[auth] fantasy usage check failed, allowing call:", e.message);
  }

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
