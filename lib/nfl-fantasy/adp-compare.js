// Attaches market ADP (sql/019_nfl_fantasy_adp.sql, populated via the
// /admin/fantasy-adp paste importer) to already-ranked players so the Cheat
// Sheet can show "our rank vs. where the market is actually drafting him."
//
// Deliberately NOT folded into ceilingVorp like schedule/personnel-adjustment.js
// do — those adjustments improve the projection itself, but ADP is the
// market's opinion, and blending it into our own rank would erase the exact
// gap the comparison exists to surface. This runs strictly after ranking is
// final.
import { normalizeName } from "./id-map.js";

// adpRows: raw rows from nfl_fantasy_adp (name, position, adp). Returns a
// normalized-name -> {adp, position} map; a name collision (e.g. the same
// paste importing two seasons) keeps the lower (earlier-drafted) ADP, since
// duplicate rows for the same name are more likely a re-import remnant than
// two same-named players both worth surfacing.
export function buildAdpByName(adpRows) {
  const byName = new Map();
  for (const row of adpRows || []) {
    const adp = Number(row.adp);
    if (!row.name || !Number.isFinite(adp)) continue;
    const key = normalizeName(row.name);
    const existing = byName.get(key);
    if (!existing || adp < existing.adp) {
      byName.set(key, { adp, position: row.position || null });
    }
  }
  return byName;
}

// Adds `adp` (market average draft position, or null if unmatched) and
// `adpDiff` (adp - rankOverall — positive means the market is drafting him
// later than we'd take him, i.e. a value; negative means the market is
// drafting him ahead of our rank, i.e. a reach) to each ranked player.
// Position is cross-checked when the ADP row carries one, to avoid a rare
// same-name collision across positions (e.g. two Mike Williamses).
export function attachAdp(ranked, adpByName) {
  return ranked.map((p) => {
    const entry = adpByName.get(normalizeName(p.name));
    const matches = entry && (!entry.position || entry.position === p.position);
    if (!matches) return { ...p, adp: null, adpDiff: null };
    return { ...p, adp: entry.adp, adpDiff: entry.adp - p.rankOverall };
  });
}
