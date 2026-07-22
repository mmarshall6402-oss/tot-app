/**
 * lib/feed-adapter/lease-lock.js
 *
 * Cross-instance dedupe for external, credit-costed fetches — e.g. two Vercel lambda
 * instances both deciding to fetch the same event's player-prop odds at once.
 *
 * Deliberately NOT a Postgres advisory lock (pg_advisory_xact_lock or similar): an
 * xact-scoped advisory lock holds its transaction — and therefore a pooled DB
 * connection — open for the entire duration of the external HTTP fetch. Through
 * Supabase's transaction-mode pooler (port 6543) that's an easy way to exhaust the
 * connection pool under exactly the concurrency this is meant to protect against,
 * trading a credit-burn bug for a connection-starvation bug. Instead this uses a
 * short-TTL lease row (see acquire_odds_lease() in sql/012_feed_adapter_credit_safety.sql)
 * that never holds a transaction across the fetch.
 *
 * Loser behavior is the part that's easy to get wrong: a loser that falls straight
 * through to fetchFn() on a cold cache reintroduces the exact double-spend this
 * exists to prevent. So losers: read the cache; on a miss, poll the cache (NOT the
 * lease row — the lease disappearing means the winner finished OR crashed, not that
 * the cache is populated) waiting for the winner; only take over and fetch if the
 * winner's own lease expires without the cache ever being populated (crash safety).
 */

const DEFAULT_TTL_SECONDS = 30;
const DEFAULT_WAIT_MS = 8000;
const POLL_INTERVAL_MS = 250;

async function releaseLease(supabase, key) {
  try {
    await supabase.from("odds_fetch_leases").delete().eq("lease_key", key);
  } catch {
    // Best-effort — an unreleased lease just expires on its own TTL.
  }
}

async function acquire(supabase, key, ttlSeconds) {
  const { data, error } = await supabase.rpc("acquire_odds_lease", { p_key: key, p_ttl_seconds: ttlSeconds });
  if (error) return { acquired: null, error }; // lease infra itself failed
  return { acquired: !!data, error: null };
}

/**
 * @param {object} supabase - Supabase client
 * @param {string} key - lease key, e.g. `props:${eventId}`
 * @param {{ ttlSeconds?: number, waitMs?: number }} opts
 * @param {() => Promise<any>} fetchFn - the actual credit-costed fetch; also
 *   responsible for writing its result into whatever cache readCacheFn reads.
 * @param {() => Promise<any>} readCacheFn - reads the cross-instance cache; must
 *   return null/undefined on a miss.
 */
export async function withLease(supabase, key, opts, fetchFn, readCacheFn) {
  const ttlSeconds = opts?.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const waitMs = opts?.waitMs ?? DEFAULT_WAIT_MS;

  const first = await acquire(supabase, key, ttlSeconds);
  if (first.error) {
    // Fail open to a live fetch rather than blocking forever on broken lease infra
    // (e.g. migration not yet applied) — worse than an unguarded fetch is a deadlock.
    console.warn("[lease-lock] acquire failed, fetching without a lease:", first.error.message);
    return fetchFn();
  }

  if (first.acquired) {
    try {
      return await fetchFn();
    } finally {
      await releaseLease(supabase, key);
    }
  }

  // Loser: warm cache short-circuits immediately, no fetch.
  const cached = await readCacheFn();
  if (cached != null) return cached;

  // Cold cache — someone else holds the lease. Wait for them to populate it.
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    const hit = await readCacheFn();
    if (hit != null) return hit;
  }

  // Winner's lease expired without ever populating the cache (timeout/crash) — take
  // over rather than deadlock. If someone else already took over, fall back to a
  // direct fetch as the last resort so this never blocks forever.
  const takeover = await acquire(supabase, key, ttlSeconds);
  if (takeover.acquired) {
    try {
      return await fetchFn();
    } finally {
      await releaseLease(supabase, key);
    }
  }
  const finalCheck = await readCacheFn();
  return finalCheck != null ? finalCheck : fetchFn();
}
