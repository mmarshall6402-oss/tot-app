import { createClient } from "@supabase/supabase-js";

// Fire-and-forget error logging for the admin System tab (see sql/020_error_log.sql).
// Never throws and never awaited by callers — a logging failure must not turn
// into a second bug on top of the one being logged.
let _sb = null;
const getSupabase = () => {
  if (!_sb) {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
    _sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  }
  return _sb;
};

export function logError(source, message, { route, meta } = {}) {
  const sb = getSupabase();
  if (!sb) return;
  sb.from("error_log")
    .insert({ source, route: route || null, message: String(message).slice(0, 2000), meta: meta || null })
    .then(() => {})
    .catch(() => {});
}
