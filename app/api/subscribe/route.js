import { createClient } from "@supabase/supabase-js";

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request) {
  try {
    const { email } = await request.json();
    if (!email || !EMAIL_RE.test(email.trim())) {
      return Response.json({ error: "Valid email required" }, { status: 400 });
    }

    const clean = email.trim().toLowerCase();
    const supabase = getSupabase();

    const { error } = await supabase
      .from("email_list")
      .upsert({ email: clean, source: "landing" }, { onConflict: "email", ignoreDuplicates: true });

    if (error) throw error;
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
