// Shared nflverse CSV fetcher — used by both the one-time historical bulk
// downloader (scripts/nfl-fantasy/fetch-nflverse.js) and the daily
// current-season ingest cron (app/api/cron/nflverse-ingest/route.js), so the
// fetch/parse/column-check logic exists in exactly one place.
//
// NOTE: release asset URLs/column names follow nflreadr's established
// schema but were NOT live-verified from this environment (outbound access
// to github.com is blocked by this sandbox's egress policy). checkColumns()
// logs a warning rather than throwing if nflverse has renamed something, so
// a schema drift surfaces in logs instead of silently breaking ingestion.
import * as XLSX_NS from "xlsx";
const XLSX = XLSX_NS.default ?? XLSX_NS;

export const RELEASE_BASE = "https://github.com/nflverse/nflverse-data/releases/download";

export async function fetchCsv(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
  const text = await res.text();
  const wb = XLSX.read(text, { type: "string" });
  const sheetName = wb.SheetNames[0];
  return XLSX.utils.sheet_to_json(wb.Sheets[sheetName]);
}

export function checkColumns(label, rows, expectedColumns) {
  if (!rows.length) {
    console.warn(`[nflverse] ${label}: 0 rows returned`);
    return;
  }
  const actual = new Set(Object.keys(rows[0]));
  const missing = (expectedColumns || []).filter((c) => !actual.has(c));
  if (missing.length) {
    console.warn(`[nflverse] ${label}: missing expected columns ${missing.join(", ")} — nflverse may have renamed these. Actual columns: ${[...actual].join(", ")}`);
  } else {
    console.log(`[nflverse] ${label}: ${rows.length} rows, columns OK`);
  }
}

// Next Gen Stats ship as three all-seasons-combined files (not one per
// season like player_stats/snap_counts), so callers filter to the season(s)
// they need after fetching.
export const NEXTGEN_STAT_TYPES = ["passing", "rushing", "receiving"];

export async function fetchNextgenStats(statType) {
  const rows = await fetchCsv(`${RELEASE_BASE}/nextgen_stats/ngs_${statType}.csv`);
  checkColumns(`nextgen_stats/${statType}`, rows, ["season", "week", "player_gsis_id", "player_display_name"]);
  return rows;
}
