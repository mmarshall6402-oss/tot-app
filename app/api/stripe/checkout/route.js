// app/api/stripe/checkout/route.js
// Creates a Stripe Checkout session for monthly or annual subscription.

import { stripe, PRICES } from "../../../../lib/stripe.js";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

export async function POST(request) {
  const { plan, userId, email } = await request.json();

  if (!PRICES[plan]) {
    return Response.json({ error: "Invalid plan" }, { status: 400 });
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    payment_method_types: ["card"],
    customer_email: email,
    line_items: [{ price: PRICES[plan], quantity: 1 }],
    subscription_data: {
      metadata: { user_id: userId },
    },
    success_url: `${APP_URL}?checkout=success`,
    cancel_url: APP_URL,
  });

  return Response.json({ url: session.url });
}
