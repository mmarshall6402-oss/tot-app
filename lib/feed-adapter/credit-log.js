/**
 * lib/feed-adapter/credit-log.js
 *
 * Mandatory predicted-vs-actual credit accounting for every adapter fetch. The Odds
 * API returns x-requests-used/x-requests-remaining on every response (previously
 * only read ad hoc in app/api/admin/debug-odds/route.js) — this makes that check
 * systematic instead of a manual admin-only debug step. Predicted-vs-actual drift
 * across odds_credit_log rows is the early-warning signal for a mis-estimated or
 * mis-cached adapter quietly burning quota.
 */

export async function logCreditUsage(supabase, { adapterKey, estimated, actualUsed = null, actualRemaining = null }) {
  try {
    await supabase.from("odds_credit_log").insert({
      adapter_key: adapterKey,
      estimated,
      actual_used: actualUsed,
      actual_remaining: actualRemaining,
    });
  } catch (e) {
    // Logging must never block a live odds fetch.
    console.warn("[credit-log] insert failed:", e?.message);
  }
}
