import { getStripe } from "../../../../lib/stripe.js";
import { createClient } from "@supabase/supabase-js";

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function POST(request) {
  if (request.headers.get("x-admin-key") !== process.env.ADMIN_KEY) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { email } = await request.json();
  if (!email) return Response.json({ error: "email required" }, { status: 400 });

  const stripe = getStripe();
  const supabase = getSupabase();

  // Find Stripe customer by email
  const customers = await stripe.customers.list({ email, limit: 5 });
  if (!customers.data.length) {
    return Response.json({ error: "No Stripe customer found for that email" }, { status: 404 });
  }

  // Find the most recent active subscription across all matching customers
  let bestSub = null;
  for (const customer of customers.data) {
    const subs = await stripe.subscriptions.list({ customer: customer.id, limit: 5, status: "all" });
    for (const sub of subs.data) {
      if (!bestSub || sub.created > bestSub.created) bestSub = sub;
    }
  }

  if (!bestSub) {
    return Response.json({ error: "No subscriptions found for that email" }, { status: 404 });
  }

  // Look up userId from Supabase auth by email — use getUserByEmail instead of
  // listUsers() which only returns the first page and can match the wrong user.
  const { data: authUser, error: authErr } = await supabase.auth.admin.getUserByEmail(email);
  if (authErr || !authUser?.user) {
    return Response.json({ error: "No Supabase auth user found for that email" }, { status: 404 });
  }

  await supabase.from("subscriptions").upsert({
    user_id: authUser.user.id,
    stripe_customer_id: bestSub.customer,
    stripe_subscription_id: bestSub.id,
    status: bestSub.status,
    current_period_end: new Date(bestSub.current_period_end * 1000).toISOString(),
  }, { onConflict: "user_id" });

  return Response.json({
    ok: true,
    email,
    userId: authUser.user.id,
    status: bestSub.status,
    subscriptionId: bestSub.id,
  });
}
