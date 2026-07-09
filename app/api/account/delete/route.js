import { getStripe } from "../../../../lib/stripe.js";
import { createClient } from "@supabase/supabase-js";
import { requireAuth } from "../../../../lib/auth.js";

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Permanently deletes the caller's account: cancels any live Stripe
// subscription, wipes their rows across user-linked tables, then removes
// the Supabase auth user itself. Irreversible — the client gates this
// behind a type-to-confirm step.
export async function POST(request) {
  const { user, error: authError } = await requireAuth(request);
  if (authError) return authError;

  const supabase = getSupabase();

  try {
    const { data: sub } = await supabase
      .from("subscriptions")
      .select("stripe_subscription_id")
      .eq("user_id", user.id)
      .single();

    if (sub?.stripe_subscription_id && !sub.stripe_subscription_id.startsWith("access_code_")) {
      try {
        await getStripe().subscriptions.cancel(sub.stripe_subscription_id);
      } catch (e) {
        // Already canceled/missing on Stripe's side — fine, keep deleting local data.
      }
    }

    await supabase.from("saved_picks").delete().eq("user_id", user.id);
    await supabase.from("subscriptions").delete().eq("user_id", user.id);
    if (user.email) {
      await supabase.from("email_list").delete().eq("email", user.email);
    }

    const { error: deleteUserError } = await supabase.auth.admin.deleteUser(user.id);
    if (deleteUserError) {
      return Response.json({ error: deleteUserError.message }, { status: 500 });
    }

    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
