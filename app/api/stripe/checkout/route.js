import { getStripe, PLANS, seasonPassCancelAt, assertSeasonPriceWontOverbill } from "../../../../lib/stripe.js";
import { requireAuth } from "../../../../lib/auth.js";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

export async function POST(request) {
  const { user, error: authError } = await requireAuth(request);
  if (authError) return authError;

  try {
    const { plan, email } = await request.json();
    const priceId = PLANS[plan];
    if (!priceId) return Response.json({ error: "invalid plan" }, { status: 400 });

    const stripe = getStripe();

    const subscription_data = plan === "season"
      ? { metadata: { userId: user.id }, cancel_at: seasonPassCancelAt() }
      : { metadata: { userId: user.id } };

    if (plan === "season") await assertSeasonPriceWontOverbill(stripe, priceId);

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: email || user.email,
      metadata: { userId: user.id },
      subscription_data,
      success_url: `${APP_URL}/?checkout=success`,
      cancel_url:  `${APP_URL}/`,
    });

    return Response.json({ url: session.url });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
