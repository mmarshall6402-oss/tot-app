// nflverse's players.csv stores birth_date as an Excel-epoch serial number
// (days since 1899-12-30 — how the xlsx package returns date-typed cells by
// default) rather than an ISO date string. This decodes that and computes
// age as of a target season, feeding lib/nfl-fantasy/project.js's aging
// curve — previously always undefined throughout the pipeline, silently
// disabling that adjustment entirely.
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const MS_PER_DAY = 86400000;
const DAYS_PER_YEAR = 365.25;

export function excelSerialToDate(serial) {
  const n = Number(serial);
  if (!Number.isFinite(n)) return null;
  return new Date(EXCEL_EPOCH_MS + n * MS_PER_DAY);
}

// Ages as of September 1 of the given season (typical NFL season start) —
// day-level precision doesn't matter for an integer-bucketed aging curve.
export function ageAsOfSeason(birthDateSerial, season) {
  const birth = excelSerialToDate(birthDateSerial);
  if (!birth) return null;
  const seasonStart = Date.UTC(season, 8, 1);
  return (seasonStart - birth.getTime()) / (DAYS_PER_YEAR * MS_PER_DAY);
}

// gsis_id-keyed age map for a given target season, built from the
// players.json crosswalk (already fetched regardless of this fix).
export function buildAgeById(playersRows, season) {
  const map = new Map();
  for (const p of playersRows || []) {
    if (!p.gsis_id) continue;
    const age = ageAsOfSeason(p.birth_date, season);
    if (age != null) map.set(p.gsis_id, age);
  }
  return map;
}
