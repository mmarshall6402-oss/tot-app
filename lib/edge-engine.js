/**
 * lib/edge-engine.js
 *
 * Shared your_prob-vs-fair_prob composition used by every FeedAdapter's normalize().
 * Deliberately dumb: it does not compute either probability itself. Adapters/models
 * supply your_prob (from whatever probability model backs that market) and fair_prob
 * (de-vigged market price, when a market was actually pulled).
 *
 * edge is only ever computed when BOTH are present. Either missing means "unranked,"
 * not "zero edge" — projection-only mode (no odds pulled) MUST get edge: null, never
 * a synthesized value like your_prob - 0.5. Inventing an edge against a market that
 * wasn't queried recreates the exact overconfidence failure mode lib/filter.js's
 * AND-gate exists to prevent, just one layer up.
 */

import { removeVig, decimalToImplied, americanToDecimal, calculateEdge } from "./edge.js";

// American odds for a two-way market -> de-vigged fair probability of `sideOdds`.
export function fairProbFromAmerican(sideOdds, oppOdds) {
  if (sideOdds == null || oppOdds == null) return null;
  const sideImplied = decimalToImplied(americanToDecimal(sideOdds));
  const oppImplied = decimalToImplied(americanToDecimal(oppOdds));
  const { fairHome } = removeVig(sideImplied, oppImplied);
  return fairHome;
}

export function composeEdge({ your_prob = null, fair_prob = null } = {}) {
  const edge = your_prob != null && fair_prob != null ? calculateEdge(your_prob, fair_prob) : null;
  return { your_prob, fair_prob, edge };
}

// Builds one NormalizedOdds row (see lib/feed-adapter/types.js).
export function normalizedOdds({ event_id, market, selection, line = null, book_price = null, your_prob = null, fair_prob = null }) {
  return { event_id, market, selection, line, book_price, ...composeEdge({ your_prob, fair_prob }) };
}
