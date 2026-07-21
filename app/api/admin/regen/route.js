import { requireAuth } from "../../../../lib/auth.js";

const CRON_SECRET = process.env.CRON_SECRET;
const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

// Returns a reason string alongside the boolean — both Moneyline's and
// Props' "Gen" buttons were coming back Unauthorized with zero way to tell
// "not logged in" apart from "email isn't on the admin list" apart from
// "the admin list env var isn't set on the server at all." Wrapped in its
// own try/catch so a genuinely unexpected throw (rather than the normal
// not-an-admin path) still reports a reason instead of vanishing into a
// platform-level 500 with no detail.
async function checkAdmin(request) {
  try {
    const { user } = await requireAuth(request);
    if (!user) return { ok: false, reason: "requireAuth found no valid session (missing/expired/unverifiable token)" };
    const raw = process.env.NEXT_PUBLIC_ADMIN_EMAILS || process.env.NEXT_PUBLIC_ADMIN_EMAIL || "";
    const admins = raw.split(",").map(e => e.trim().toLowerCase()).filter(Boolean);
    if (!admins.length) return { ok: false, reason: "NEXT_PUBLIC_ADMIN_EMAILS / NEXT_PUBLIC_ADMIN_EMAIL is not set on the server" };
    if (!admins.includes(user.email?.toLowerCase())) {
      return { ok: false, reason: `authenticated as ${user.email || "(no email on token)"}, which is not in the admin list` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: `checkAdmin threw: ${e.message}` };
  }
}

// Unique per boot/request — if this doesn't show up in the client's result
// box at all, the deployment serving these requests isn't running this
// source file, full stop, regardless of what Vercel's dashboard claims.
const BUILD_MARKER = `regen-debug-${Date.now()}`;

export async function POST(request) {
  try {
    const admin = await checkAdmin(request);
    if (!admin.ok) {
      return Response.json({ error: "Unauthorized", reason: admin.reason, marker: BUILD_MARKER }, { status: 401 });
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
  } catch (e) {
    return Response.json({ error: "regen route threw", message: e.message, marker: BUILD_MARKER }, { status: 500 });
  }
}
