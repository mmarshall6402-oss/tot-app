/**
 * lib/feed-adapter/mlb-moneyline.js
 *
 * First FeedAdapter — wraps the existing MLB moneyline pipeline (lib/odds.js) with
 * zero behavior change. fetch()/normalize()/estimateCredits() are new; the TOA call,
 * the SGO/ESPN supplement waterfall, and the in-memory cache in lib/odds.js are
 * untouched. Not wired into any route yet (Phase 0 is scaffold-only).
 */
import { fetchMLBOdds, getTOACreditHeaders } from "../odds.js";
import { normalizedOdds } from "../edge-engine.js";
import { logCreditUsage } from "./credit-log.js";

export const key = "mlb_moneyline";
export const markets = ["h2h"];
export const regions = ["us"];
export const refreshCadenceMs = 1000 * 60 * 15; // matches lib/odds.js's own TTL

// h2h is billed once per sport x region combination regardless of how many games
// come back — this adapter always issues exactly one TOA call per live fetch.
export function estimateCredits() {
  return markets.length * regions.length;
}

/**
 * @param {{ supabase?: object }} ctx - supabase is optional; omit it to fetch
 *   without credit logging (e.g. local/dev use).
 */
export async function fetch(ctx = {}) {
  const startedAt = Date.now();
  const games = await fetchMLBOdds();
  if (ctx.supabase) {
    const headers = getTOACreditHeaders();
    await logCreditUsage(ctx.supabase, {
      adapterKey: key,
      estimated: estimateCredits(),
      actualUsed: headers?.used != null ? parseInt(headers.used, 10) : null,
      actualRemaining: headers?.remaining != null ? parseInt(headers.remaining, 10) : null,
      durationMs: Date.now() - startedAt,
    });
  }
  return games;
}

/**
 * @param {Array} games - fetchMLBOdds() shape
 * @param {Map<string, number>|null} modelOutputs - optional, keyed by
 *   `${event_id}|${selection}` -> your_prob (0-1). An absent entry means odds-only
 *   normalization for that selection: your_prob and edge both come back null,
 *   never guessed.
 */
export function normalize(games, modelOutputs = null) {
  const out = [];
  for (const g of games) {
    for (const selection of [
      { name: g.homeTeam, price: g.homeOdds, fair: g.homeImplied },
      { name: g.awayTeam, price: g.awayOdds, fair: g.awayImplied },
    ]) {
      if (selection.price == null) continue;
      const your_prob = modelOutputs?.get(`${g.id}|${selection.name}`) ?? null;
      out.push(normalizedOdds({
        event_id: g.id,
        market: "moneyline",
        selection: selection.name,
        book_price: selection.price,
        fair_prob: selection.fair ?? null,
        your_prob,
      }));
    }
  }
  return out;
}
