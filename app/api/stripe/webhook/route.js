import { getStripe } from "../../../../lib/stripe.js";
import { createClient } from "@supabase/supabase-js";

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function POST(request) {
  const stripe = getStripe();
  const body = await request.text();
  const sig  = request.headers.get("stripe-signature");

  let event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    return Response.json({ error: `Webhook error: ${e.message}` }, { status: 400 });
  }

  const supabase = getSupabase();

  if (event.type === "customer.subscription.created" || event.type === "customer.subscription.updated") {
    const sub    = event.data.object;
    const userId = sub.metadata?.user_id;
    if (!userId) return Response.json({ received: true });

    const priceId = sub.items.data[0]?.price?.id;
    const plan = priceId === process.env.STRIPE_ANNUAL_PRICE_ID ? "annual" : "monthly";

    await supabase.from("subscriptions").upsert({
      user_id:                userId,
      stripe_customer_id:     sub.customer,
      stripe_subscription_id: sub.id,
      status:                 sub.status,
      plan,
      current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
      updated_at:         new Date().toISOString(),
    }, { onConflict: "stripe_subscription_id" });
  }

  if (event.type === "customer.subscription.deleted") {
    const sub = event.data.object;
    await supabase.from("subscriptions")
      .update({ status: "canceled", updated_at: new Date().toISOString() })
      .eq("stripe_subscription_id", sub.id);
  }

  return Response.json({ received: true });
}
