// Average Draft Position (ADP) from FantasyFootballCalculator's free,
// no-key public API — same "free, no-key" sourcing posture as
// Sleeper/ESPN elsewhere in lib/nfl-fantasy/*. FFC doesn't publish a
// gsis_id or any other crosswalk-able id, only player names, so this joins
// to the model's own rankings by normalizeName (lib/nfl-fantasy/id-map.js)
// rather than the gsis_id crosswalk used everywhere else.
//
// NOTE: NOT live-verified from this environment (outbound network to
// fantasyfootballcalculator.com is blocked by this sandbox's egress
// policy) — same disclaimer already carried by
// scripts/nfl-fantasy/fetch-nflverse.js for nflverse. Verify the response
// shape once with real network access before trusting this in production.
import { normalizeName } from "./id-map.js";

const FFC_BASE = "https://fantasyfootballcalculator.com/api/v1/adp";

const FORMAT_TO_FFC = { ppr: "ppr", half_ppr: "half-ppr", standard: "standard" };

export async function fetchAdp(format, { teams = 12, season } = {}) {
  const ffcFormat = FORMAT_TO_FFC[format];
  if (!ffcFormat) throw new Error(`unknown scoring format: ${format}`);
  const params = new URLSearchParams({ teams: String(teams) });
  if (season) params.set("year", String(season));
  const res = await fetch(`${FFC_BASE}/${ffcFormat}?${params}`, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`FFC ADP ${ffcFormat} -> ${res.status}`);
  const json = await res.json();
  return json?.players || [];
}

// Ranks ascending by adp (lowest adp = drafted first = best), keyed by
// normalizeName so it can be joined against the model's own rankings
// without a shared id. Players missing a name or adp value are skipped —
// a handful of these show up in FFC's feed for barely-drafted deep bench
// players and would otherwise sort to a meaningless rank 1.
export function buildAdpIndex(players) {
  const sorted = (players || [])
    .filter((p) => p?.name && Number.isFinite(Number(p.adp)))
    .sort((a, b) => Number(a.adp) - Number(b.adp));
  const byName = new Map();
  sorted.forEach((p, i) => {
    byName.set(normalizeName(p.name), { adp: Number(p.adp), adpRank: i + 1, position: p.position || null, team: p.team || null });
  });
  return byName;
}

// Positive = the model ranks the player better than the market drafts them
// (they'll still be on the board later than the model thinks they should
// last) — a value pick. Negative = the market drafts them earlier than the
// model would — a reach relative to the model. Matches the conventional
// "ADP - projected rank" value-delta definition fantasy sites use.
export function valueDelta(adpRank, rankOverall) {
  if (adpRank == null || rankOverall == null) return null;
  return adpRank - rankOverall;
}
