/**
 * lib/feed-adapter/mlb-props.js
 *
 * Second FeedAdapter — MLB player props via the /events/{eventId}/odds endpoint
 * (lib/odds-props.js). Unlike mlb-moneyline this is NOT "wrap unchanged": the
 * existing live-refresh path in app/api/props/route.js has no cross-instance
 * concurrency guard, so a lineup posting mid-day can have multiple warm Vercel
 * instances each pay credits for the same event. This adapter adds the guard
 * (lease-lock.js + a cross-instance props cache) at the fetch layer so every
 * caller — cron, live-refresh, future callers — gets it for free.
 *
 * Not wired into any route yet (Phase 0 is scaffold-only).
 */
import { fetchEventPlayerProps, getPropsCreditHeaders } from "../odds-props.js";
import { normalizedOdds, fairProbFromAmerican } from "../edge-engine.js";
import { withLease } from "./lease-lock.js";
import { logCreditUsage } from "./credit-log.js";

export const key = "mlb_props";
export const markets = ["pitcher_strikeouts", "batter_home_runs"];
export const regions = ["us"];
export const refreshCadenceMs = 1000 * 60 * 30; // matches lib/odds-props.js's own TTL
const CACHE_TTL_MS = refreshCadenceMs;

// Billed per event actually fetched: markets x regions.
export function estimateCredits(eventIds) {
  return eventIds.length * markets.length * regions.length;
}

async function readCache(supabase, eventId) {
  const { data: row } = await supabase
    .from("odds_props_cache")
    .select("payload, fetched_at")
    .eq("event_id", eventId)
    .single();
  if (!row) return null;
  if (Date.now() - new Date(row.fetched_at).getTime() > CACHE_TTL_MS) return null;
  return row.payload;
}

async function writeCache(supabase, eventId, payload) {
  try {
    await supabase.from("odds_props_cache")
      .upsert({ event_id: eventId, payload, fetched_at: new Date().toISOString() }, { onConflict: "event_id" });
  } catch (e) {
    console.warn("[mlb-props adapter] cache write failed:", e?.message);
  }
}

async function fetchOneEvent(supabase, eventId) {
  return withLease(
    supabase,
    `props:${eventId}`,
    { ttlSeconds: 30, waitMs: 8000 },
    async () => {
      const data = await fetchEventPlayerProps(eventId);
      await writeCache(supabase, eventId, data);
      const headers = getPropsCreditHeaders();
      await logCreditUsage(supabase, {
        adapterKey: key,
        estimated: markets.length * regions.length,
        actualUsed: headers?.used != null ? parseInt(headers.used, 10) : null,
        actualRemaining: headers?.remaining != null ? parseInt(headers.remaining, 10) : null,
      });
      return data;
    },
    () => readCache(supabase, eventId)
  );
}

/**
 * @param {{ supabase: object, eventIds: string[] }} ctx - eventIds MUST already be
 *   ordered by the caller using pre-fetch-known signals ONLY (lineup-confirmed
 *   first, then soonest commenceTime, then today before tomorrow) — never by edge
 *   or model probability, neither of which exists until after this call returns.
 *   Trim eventIds with a CreditBudget (lib/feed-adapter/types.js) BEFORE calling
 *   fetch(), using estimateCredits() above.
 */
export async function fetch({ supabase, eventIds }) {
  const settled = await Promise.allSettled(eventIds.map(id => fetchOneEvent(supabase, id)));
  const results = [];
  settled.forEach((r, i) => {
    if (r.status === "fulfilled" && r.value) results.push(r.value);
    else if (r.status === "rejected") console.warn(`[mlb-props adapter] event ${eventIds[i]} failed:`, r.reason?.message);
  });
  return results;
}

/**
 * @param {Array} eventProps - fetchEventPlayerProps() shapes, one per event
 * @param {Map<string, number>|null} modelOutputs - optional, keyed by
 *   `${eventId}|${market}|${player}` -> your_prob (0-1), e.g. from
 *   lib/prop-probability.js's projectPitcherKs/projectBatterHR. An absent entry
 *   means odds-only normalization for that line: your_prob/edge come back null.
 */
export function normalize(eventProps, modelOutputs = null) {
  const out = [];
  for (const props of eventProps) {
    for (const s of props.strikeouts || []) {
      out.push(normalizedOdds({
        event_id: props.eventId,
        market: "pitcher_strikeouts",
        selection: `${s.player} Over`,
        line: s.line,
        book_price: s.overOdds,
        fair_prob: fairProbFromAmerican(s.overOdds, s.underOdds),
        your_prob: modelOutputs?.get(`${props.eventId}|pitcher_strikeouts|${s.player}`) ?? null,
      }));
    }
    for (const h of props.homeRuns || []) {
      out.push(normalizedOdds({
        event_id: props.eventId,
        market: "batter_home_runs",
        selection: `${h.player} Yes`,
        line: null,
        book_price: h.yesOdds,
        fair_prob: fairProbFromAmerican(h.yesOdds, h.noOdds),
        your_prob: modelOutputs?.get(`${props.eventId}|batter_home_runs|${h.player}`) ?? null,
      }));
    }
  }
  return out;
}
