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
 * Loser behavior is the part that's easy to get wrong, in two directions:
 *   - Fall straight through to fetchFn() on a cold cache -> reintroduces the exact
 *     double-spend this exists to prevent.
 *   - Give up waiting on a timer that's SHORTER than the lease TTL -> the loser tries
 *     to take over, fails (the winner's lease is still legitimately valid), and if
 *     the fallback logic isn't careful it fetches anyway — same double-spend, just
 *     triggered by an unrelated constant instead of a missing cache. (This was a real
 *     bug in the first version of this file: DEFAULT_WAIT_MS was a fixed 8s, entirely
 *     independent of the 30s TTL passed by callers, so every race where the winner
 *     took longer than 8s double-spent regardless of TTL.)
 *
 * Fix: the loser's wait ceiling is DERIVED from ttlSeconds (plus margin), never an
 * independent constant, and takeover is only attempted once acquire_odds_lease()
 * itself reports the lease actually expired — never on a wall-clock timeout alone.
 * If the ceiling is hit without a takeover succeeding (should not happen absent a
 * bug), this fails LOUD (console.error) and fetches as an explicit last resort — the
 * dedupe guarantee not holding is itself something that must be visible, not a silent
 * fallback path.
 */

const DEFAULT_TTL_SECONDS = 30;
const TAKEOVER_MARGIN_MS = 5000; // clock-skew/latency slop beyond the lease's own TTL
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
 * @param {{ ttlSeconds?: number, maxWaitMs?: number }} opts - maxWaitMs defaults to
 *   ttlSeconds*1000 + TAKEOVER_MARGIN_MS; pass it explicitly only to widen the
 *   margin (e.g. a known-slow upstream), never to shrink it below the TTL.
 * @param {() => Promise<any>} fetchFn - the actual credit-costed fetch; also
 *   responsible for writing its result into whatever cache readCacheFn reads.
 * @param {() => Promise<any>} readCacheFn - reads the cross-instance cache; must
 *   return null/undefined on a miss.
 */
export async function withLease(supabase, key, opts, fetchFn, readCacheFn) {
  const ttlSeconds = opts?.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const maxWaitMs = opts?.maxWaitMs ?? (ttlSeconds * 1000 + TAKEOVER_MARGIN_MS);

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

  // Cold cache — someone else holds the lease. Poll the cache AND, each tick, try to
  // acquire — acquire_odds_lease() only ever succeeds once the winner's lease has
  // genuinely expired (crash/timeout), so this can't take over a still-valid lease
  // no matter how long the loop runs. That's what makes maxWaitMs safe to be >= TTL:
  // waiting the full TTL is normal, not a bug.
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const hit = await readCacheFn();
    if (hit != null) return hit;

    const takeover = await acquire(supabase, key, ttlSeconds);
    if (takeover.acquired) {
      try {
        return await fetchFn();
      } finally {
        await releaseLease(supabase, key);
      }
    }

    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }

  // Exceeded ttlSeconds + margin without the winner finishing (cache) or its lease
  // ever clearing (takeover). Should not happen — surfaces a real bug (e.g. TTL set
  // shorter than the actual fetch, or the winner's release path itself broken) rather
  // than a normal outcome, so this is loud, not a quiet fallback.
  console.error(`[lease-lock] ${key}: exceeded max wait (${maxWaitMs}ms) with no cache hit and no lease takeover — fetching directly, dedupe not honored this call`);
  return fetchFn();
}
