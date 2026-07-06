import { getStripe } from "../../../../lib/stripe.js";
import { createClient } from "@supabase/supabase-js";

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Requires the unique constraint added by sql/003_subscriptions_unique_user_id.sql.
// A real upsert makes concurrent webhook deliveries for the same user (e.g.
// checkout.session.completed and customer.subscription.created arriving close
// together) resolve atomically at the DB level instead of racing on a
// select-then-insert-or-update, which could previously create duplicate rows.
async function writeSubscription(supabase, fields) {
  await supabase.from("subscriptions").upsert(fields, { onConflict: "user_id" });
}

export async function POST(request) {
  const sig = request.headers.get("stripe-signature");
  const body = await request.text();

  let event;
  try {
    event = getStripe().webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    return Response.json({ error: e.message }, { status: 400 });
  }

  const supabase = getSupabase();
  const obj = event.data.object;

  // Fires immediately after payment — session carries userId metadata directly.
  // This is the fastest path to unlocking access after checkout.
  if (event.type === "checkout.session.completed") {
    const userId = obj.metadata?.userId;
    const subscriptionId = obj.subscription;
    if (userId && subscriptionId) {
      await writeSubscription(supabase, {
        user_id: userId,
        stripe_customer_id: obj.customer,
        stripe_subscription_id: subscriptionId,
        status: "active",
        current_period_end: null,
      });
    }
    return Response.json({ received: true });
  }

  // Subscription events carry userId via subscription_data.metadata (set at checkout).
  if (["customer.subscription.created", "customer.subscription.updated"].includes(event.type)) {
    const userId = obj.metadata?.userId;
    if (!userId) return Response.json({ received: true });

    await writeSubscription(supabase, {
      user_id: userId,
      stripe_customer_id: obj.customer,
      stripe_subscription_id: obj.id,
      status: obj.status,
      current_period_end: new Date(obj.current_period_end * 1000).toISOString(),
    });
  }

  if (event.type === "customer.subscription.deleted") {
    await supabase
      .from("subscriptions")
      .update({ status: "canceled" })
      .eq("stripe_subscription_id", obj.id);
  }

  return Response.json({ received: true });
}
