import { requireAuth } from "../../../../lib/auth.js";

const CRON_SECRET = process.env.CRON_SECRET;
const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

// Returns a reason string alongside the boolean so a caller can tell "not
// logged in" apart from "email isn't on the admin list" apart from "the
// admin list env var isn't set on the server at all" — all three used to
// collapse into one indistinguishable generic Unauthorized.
async function checkAdmin(request) {
  const { user } = await requireAuth(request);
  if (!user) return { ok: false, reason: "no valid session (missing/expired/unverifiable token)" };
  const raw = process.env.NEXT_PUBLIC_ADMIN_EMAILS || process.env.NEXT_PUBLIC_ADMIN_EMAIL || "";
  const admins = raw.split(",").map(e => e.trim().toLowerCase()).filter(Boolean);
  if (!admins.length) return { ok: false, reason: "admin email list is not configured on the server" };
  if (!admins.includes(user.email?.toLowerCase())) {
    return { ok: false, reason: `${user.email || "(no email on token)"} is not on the admin list` };
  }
  return { ok: true };
}

export async function POST(request) {
  const admin = await checkAdmin(request);
  if (!admin.ok) {
    return Response.json({ error: "Unauthorized", reason: admin.reason }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));

  if (body.type === "player-index") {
    const res = await fetch(`${BASE_URL}/api/cron/player-index`, {
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
    });
    const data = await res.json().catch(() => ({}));
    return Response.json(data, { status: res.status });
  }

  if (body.type === "props") {
    const res = await fetch(`${BASE_URL}/api/cron/props`, {
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
    });
    const data = await res.json().catch(() => ({}));
    return Response.json(data, { status: res.status });
  }

  if (body.sport === "nfl") {
    const nflParams = new URLSearchParams();
    if (body.date) nflParams.set("date", body.date);
    if (body.preseason) nflParams.set("preseason", "1");
    const res = await fetch(`${BASE_URL}/api/cron/nfl-picks?${nflParams}`, {
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
    });
    const data = await res.json().catch(() => ({}));
    return Response.json(data, { status: res.status });
  }

  const params = new URLSearchParams({ force: "1" });
  if (body.date) params.set("date", body.date);

  const res = await fetch(`${BASE_URL}/api/cron/picks?${params}`, {
    headers: { Authorization: `Bearer ${CRON_SECRET}` },
  });

  const data = await res.json().catch(() => ({}));
  return Response.json(data, { status: res.status });
}
