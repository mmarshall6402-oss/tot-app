// Joins nflverse's gsis_id-keyed stats to ESPN's athlete-id-keyed roster/injury
// data (lib/nfl-roster.js) via nflverse's players.csv, which carries both ids.
// Falls back to name matching for players missing from the crosswalk (recent
// rookies, practice-squad call-ups) rather than dropping them — a missing
// crosswalk row shouldn't erase a real player from the rankings.

export function normalizeName(name) {
  return (name || "")
    .toLowerCase()
    .replace(/[.'`]/g, "")
    .replace(/\s+(jr|sr|ii|iii|iv|v)\.?$/, "")
    .trim();
}

// rows: parsed players.csv records. Expected fields: gsis_id, espn_id, name
// (or full_name/display_name/merge_name — nflverse has renamed this column
// across releases, so all common variants are checked).
export function buildIdCrosswalk(rows) {
  const byGsisId = new Map();
  const byNormalizedName = new Map();

  for (const row of rows || []) {
    const gsisId = row.gsis_id || row.gsis_id_2 || null;
    const espnId = row.espn_id || null;
    const name = row.display_name || row.full_name || row.merge_name || row.name || null;
    if (!gsisId) continue;

    const entry = { gsisId, espnId: espnId ? String(espnId) : null, name, position: row.position || null };
    byGsisId.set(gsisId, entry);
    if (name) byNormalizedName.set(normalizeName(name), entry);
  }

  return {
    espnIdFor(gsisId) {
      return byGsisId.get(gsisId)?.espnId || null;
    },
    entryFor(gsisId) {
      return byGsisId.get(gsisId) || null;
    },
    // Name-fallback for players the gsis_id lookup misses.
    espnIdForName(name) {
      return byNormalizedName.get(normalizeName(name))?.espnId || null;
    },
  };
}
