import { getStripe, PLANS } from "../../../../lib/stripe.js";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

export async function POST(request) {
  try {
    const { plan, userId, email } = await request.json();
    const priceId = PLANS[plan];
    if (!priceId) return Response.json({ error: "invalid plan" }, { status: 400 });

    const session = await getStripe().checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: email,
      metadata: { userId },
      subscription_data: { metadata: { userId } },
      success_url: `${APP_URL}/app?checkout=success`,
      cancel_url:  `${APP_URL}/app`,
    });

    return Response.json({ url: session.url });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
