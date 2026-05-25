import { getStripe } from "../../../../lib/stripe.js";
import { createClient } from "@supabase/supabase-js";
import { requireAuth } from "../../../../lib/auth.js";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function POST(request) {
  const { user, error: authError } = await requireAuth(request);
  if (authError) return authError;

  try {
    const { data } = await getSupabase()
      .from("subscriptions")
      .select("stripe_customer_id")
      .eq("user_id", user.id)
      .single();

    if (!data?.stripe_customer_id) {
      return Response.json({ error: "no subscription found" }, { status: 404 });
    }

    const session = await getStripe().billingPortal.sessions.create({
      customer: data.stripe_customer_id,
      return_url: APP_URL,
    });

    return Response.json({ url: session.url });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
