// Shared CSV fetch + column-sanity-check helpers for nflverse's public
// release assets (github.com/nflverse/nflverse-data) — used by both the
// one-time historical bulk downloader (scripts/nfl-fantasy/fetch-nflverse.js,
// completed seasons only) and the in-season weekly refresh cron
// (app/api/cron/nflverse-refresh, current season only). Split out so the two
// callers can't drift on how a release CSV gets parsed.
import * as XLSX_NS from "xlsx";
const XLSX = XLSX_NS.default ?? XLSX_NS;

export const RELEASE_BASE = "https://github.com/nflverse/nflverse-data/releases/download";

export async function fetchNflverseCsv(url, { timeoutMs = 120000 } = {}) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
  const text = await res.text();
  const wb = XLSX.read(text, { type: "string" });
  const sheetName = wb.SheetNames[0];
  return XLSX.utils.sheet_to_json(wb.Sheets[sheetName]);
}

// Expected columns per file, used only to log a warning if nflverse has
// renamed something — parsing still proceeds with whatever columns exist,
// since downstream code already treats missing fields as absent rather than
// throwing.
const EXPECTED_COLUMNS = {
  player_stats: ["player_id", "player_name", "position", "recent_team", "season", "week", "passing_yards", "passing_tds", "rushing_yards", "rushing_tds", "receptions", "receiving_yards", "receiving_tds"],
  players: ["gsis_id", "espn_id", "display_name", "position"],
  snap_counts: ["pfr_player_id", "player", "position", "team", "season", "week", "offense_pct"],
};

export function checkNflverseColumns(label, rows) {
  if (!rows.length) {
    console.warn(`[nflverse] ${label}: 0 rows returned`);
    return;
  }
  const actual = new Set(Object.keys(rows[0]));
  const missing = (EXPECTED_COLUMNS[label] || []).filter((c) => !actual.has(c));
  if (missing.length) {
    console.warn(`[nflverse] ${label}: missing expected columns ${missing.join(", ")} — nflverse may have renamed these. Actual columns: ${[...actual].join(", ")}`);
  } else {
    console.log(`[nflverse] ${label}: ${rows.length} rows, columns OK`);
  }
}
