import { requireAuth } from "../../../../lib/auth.js";

const CRON_SECRET = process.env.CRON_SECRET;
const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

async function checkAdmin(request) {
  const { user } = await requireAuth(request);
  if (!user) return false;
  const admins = (process.env.NEXT_PUBLIC_ADMIN_EMAILS || process.env.NEXT_PUBLIC_ADMIN_EMAIL || "")
    .split(",").map(e => e.trim().toLowerCase()).filter(Boolean);
  return admins.includes(user.email?.toLowerCase());
}

export async function POST(request) {
  if (!await checkAdmin(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));

  if (body.type === "player-index") {
    const res = await fetch(`${BASE_URL}/api/cron/player-index`, {
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
