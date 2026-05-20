import { requireAuth } from "../../../lib/auth.js";
import { timingSafeEqual } from "../../../lib/auth.js";

export async function GET(request) {
  // Require admin key — not exposed publicly
  const key = request.headers.get("x-admin-key");
  if (!timingSafeEqual(key, process.env.ADMIN_KEY)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return Response.json({
    hasAnthropicKey: !!process.env.ANTHROPIC_API_KEY,
    hasSportsDataKey: !!process.env.SPORTSDATA_API_KEY,
    hasSportsGameOddsKey: !!process.env.SPORTSGAMEODDS_API_KEY,
    hasStripeKey: !!process.env.STRIPE_SECRET_KEY,
    hasSupabaseServiceKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
  });
}
