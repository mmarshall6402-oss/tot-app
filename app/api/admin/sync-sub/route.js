import { getStripe } from "../../../../lib/stripe.js";
import { createClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "../../../../lib/auth.js";

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function POST(request) {
  if (!timingSafeEqual(request.headers.get("x-admin-key"), process.env.ADMIN_KEY)) {
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

  // Look up userId via the admin REST API with an email filter — avoids
  // listUsers() pagination issues and works with all @supabase/supabase-js versions.
  const usersRes = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/admin/users?filter=${encodeURIComponent(`email=eq.${email}`)}`,
    { headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` } }
  );
  const usersData = await usersRes.json();
  const authUser = usersData?.users?.[0];
  if (!authUser) {
    return Response.json({ error: "No Supabase auth user found for that email" }, { status: 404 });
  }

  const fields = {
    user_id: authUser.id,
    stripe_customer_id: bestSub.customer,
    stripe_subscription_id: bestSub.id,
    status: bestSub.status,
    current_period_end: new Date(bestSub.current_period_end * 1000).toISOString(),
  };

  const { data: existing } = await supabase.from("subscriptions").select("id").eq("user_id", authUser.id).single();
  if (existing) {
    await supabase.from("subscriptions").update(fields).eq("user_id", authUser.id);
  } else {
    await supabase.from("subscriptions").insert(fields);
  }

  return Response.json({
    ok: true,
    email,
    userId: authUser.id,
    status: bestSub.status,
    subscriptionId: bestSub.id,
  });
}
