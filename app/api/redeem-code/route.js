import { createClient } from "@supabase/supabase-js";
import { requireAuth } from "../../../lib/auth.js";

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function POST(request) {
  try {
    const { user, error: authError } = await requireAuth(request);
    if (authError) return authError;

    const { code } = await request.json();
    const userId = user.id;
    if (!code) return Response.json({ error: "code required" }, { status: 400 });

    const supabase = getSupabase();
    const clean = code.trim().toUpperCase();

    // Look up the code
    const { data: ac } = await supabase
      .from("access_codes")
      .select("*")
      .eq("code", clean)
      .single();

    if (!ac) return Response.json({ error: "Invalid code" }, { status: 404 });
    if (ac.expires_at && new Date(ac.expires_at) < new Date()) {
      return Response.json({ error: "Code has expired" }, { status: 410 });
    }
    if (ac.uses_max !== null && ac.uses_count >= ac.uses_max) {
      return Response.json({ error: "Code has reached its limit" }, { status: 410 });
    }

    // Atomically claim a use slot before granting access — the WHERE guard is
    // re-checked against the row's live state, so two concurrent redemptions
    // of a single-use code can't both pass (row-level locking serializes the
    // two UPDATEs; the second sees the already-incremented count and fails
    // the `.lt()` condition instead of overwriting it).
    if (ac.uses_max !== null) {
      const { data: claimed } = await supabase
        .from("access_codes")
        .update({ uses_count: ac.uses_count + 1 })
        .eq("id", ac.id)
        .lt("uses_count", ac.uses_max)
        .select("id");
      if (!claimed?.length) {
        return Response.json({ error: "Code has reached its limit" }, { status: 410 });
      }
    } else {
      await supabase.from("access_codes").update({ uses_count: ac.uses_count + 1 }).eq("id", ac.id);
    }

    // Grant access — create/update subscription row
    const { data: existing } = await supabase.from("subscriptions").select("id").eq("user_id", userId).single();
    const subData = {
      user_id: userId,
      stripe_customer_id: null,
      stripe_subscription_id: `access_code_${clean}_${userId.slice(0, 8)}`,
      status: "active",
      current_period_end: ac.expires_at || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    };
    if (existing) {
      await supabase.from("subscriptions").update(subData).eq("user_id", userId);
    } else {
      await supabase.from("subscriptions").insert(subData);
    }

    return Response.json({ ok: true, label: ac.label });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
