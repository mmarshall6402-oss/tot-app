// Bet Slip Tracker — free for every tier (no requirePro gate). Accepts an
// uploaded bet-slip screenshot, reads it via Claude vision
// (lib/bets/parse-slip.js), and saves it to bet_slips/bet_legs
// (sql/031_bet_slips.sql). See that migration's header comment for why this
// table uses real RLS while most of the app doesn't: every read/write here
// goes through a Supabase client authenticated with the user's own JWT, not
// the service-role key, so RLS — not this route — is the actual ownership
// boundary.
import { createClient } from "@supabase/supabase-js";
import { requireAuth } from "../../../lib/auth.js";
import { parseBetSlip } from "../../../lib/bets/parse-slip.js";

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_BYTES = 4 * 1024 * 1024;
const DAILY_LIMIT = 20;

function serviceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

// Scoped to the caller's own JWT (not the service-role key) so the RLS
// policies on bet_slips/bet_legs actually apply — see sql/031's header.
function userClient(token) {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

function bearerToken(request) {
  return request.headers.get("authorization")?.replace("Bearer ", "").trim() || null;
}

export async function POST(request) {
  const { user, error: authError } = await requireAuth(request);
  if (authError) return authError;

  // Count every attempt (not just successful saves) before doing any
  // expensive work, using the same atomic check-and-increment idiom as
  // increment_fantasy_usage (sql/017) — see sql/031 for why this is its own
  // table rather than that one.
  try {
    const svc = serviceClient();
    const today = new Date().toISOString().slice(0, 10);
    const { data, error: rpcError } = await svc.rpc("increment_bet_slip_usage", {
      p_user_id: user.id, p_day: today, p_limit: DAILY_LIMIT,
    });
    if (rpcError) throw rpcError;
    const allowed = Array.isArray(data) ? data[0]?.allowed : data?.allowed;
    if (allowed === false) {
      return Response.json({ error: `You've hit the ${DAILY_LIMIT}/day bet slip upload limit — try again tomorrow.` }, { status: 429 });
    }
  } catch (e) {
    return Response.json({ error: `Rate limit check failed: ${e.message}` }, { status: 500 });
  }

  let formData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json({ error: "Expected multipart/form-data with an image field" }, { status: 400 });
  }

  const file = formData.get("image");
  const timezone = String(formData.get("timezone") || "UTC");
  if (!file || typeof file === "string") {
    return Response.json({ error: "image is required" }, { status: 400 });
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return Response.json({ error: "image must be JPEG, PNG, or WebP" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ error: "image must be under 4MB" }, { status: 400 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const base64 = buf.toString("base64");

  let parsed;
  try {
    parsed = await parseBetSlip(base64, file.type, timezone);
  } catch (e) {
    return Response.json({ error: `Could not read bet slip: ${e.message}` }, { status: 502 });
  }

  if (!parsed.is_bet_slip) {
    return Response.json({ error: "That doesn't look like a bet slip — try a clearer screenshot of the full ticket." }, { status: 422 });
  }
  if (!parsed.ticket_id) {
    return Response.json({ error: "Couldn't find a ticket ID on this slip — try a screenshot that shows the full ticket." }, { status: 422 });
  }

  const supabase = userClient(bearerToken(request));
  const { data: slipId, error: insertError } = await supabase.rpc("insert_bet_slip", {
    p_slip: {
      book: parsed.book || "Unknown",
      ticket_id: parsed.ticket_id,
      stake: parsed.stake,
      max_payout: parsed.max_payout,
      placed_at: parsed.placed_at,
      legs: parsed.legs,
    },
  });

  if (insertError) {
    if (insertError.code === "23505") {
      return Response.json({ error: "You've already uploaded this slip." }, { status: 409 });
    }
    return Response.json({ error: `Could not save slip: ${insertError.message}` }, { status: 500 });
  }

  const { data: saved, error: fetchError } = await supabase
    .from("bet_slips")
    .select("*, bet_legs(*)")
    .eq("id", slipId)
    .single();
  if (fetchError) return Response.json({ error: fetchError.message }, { status: 500 });

  return Response.json({ slip: saved });
}

export async function GET(request) {
  const { error: authError } = await requireAuth(request);
  if (authError) return authError;

  const supabase = userClient(bearerToken(request));
  const { data, error } = await supabase
    .from("bet_slips")
    .select("*, bet_legs(*)")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ slips: data || [] });
}
