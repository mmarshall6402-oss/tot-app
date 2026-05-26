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
  const params = new URLSearchParams({ force: "1" });
  if (body.date) params.set("date", body.date);

  const res = await fetch(`${BASE_URL}/api/cron/picks?${params}`, {
    headers: { Authorization: `Bearer ${CRON_SECRET}` },
  });

  const data = await res.json().catch(() => ({}));
  return Response.json(data, { status: res.status });
}
