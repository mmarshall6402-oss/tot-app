import { createClient } from "@supabase/supabase-js";

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function GET(request) {
  const email = new URL(request.url).searchParams.get("email");
  if (!email) return new Response("Missing email", { status: 400 });

  await getSupabase().from("email_list").delete().eq("email", decodeURIComponent(email).toLowerCase());

  return new Response(
    `<!DOCTYPE html><html><body style="background:#000;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;">
      <div style="text-align:center;"><div style="font-size:24px;margin-bottom:12px;">✓ Unsubscribed</div>
      <div style="color:#444;font-size:14px;">You won't receive any more picks.</div>
      <a href="/" style="display:inline-block;margin-top:20px;color:#00FF87;font-size:13px;">← Back to app</a></div>
    </body></html>`,
    { headers: { "Content-Type": "text/html" } }
  );
}
