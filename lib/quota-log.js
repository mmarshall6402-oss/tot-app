import { createClient } from "@supabase/supabase-js";

// Fire-and-forget quota snapshots (see sql/022_api_quota_log.sql). Called from
// real The Odds API responses — never from a dedicated probe — so recording
// the trend doesn't itself spend quota. Never throws.
let _sb = null;
const getSupabase = () => {
  if (!_sb) {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
    _sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  }
  return _sb;
};

export function logQuotaSnapshot(source, remaining, used) {
  if (remaining == null && used == null) return;
  const sb = getSupabase();
  if (!sb) return;
  sb.from("api_quota_log")
    .insert({ source, requests_remaining: remaining != null ? parseInt(remaining) : null, requests_used: used != null ? parseInt(used) : null })
    .then(() => {})
    .catch(() => {});
}
