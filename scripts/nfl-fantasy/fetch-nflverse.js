// scripts/nfl-fantasy/fetch-nflverse.js
//
// One-time/off-season bulk downloader for nflverse's public, no-key-required
// historical NFL stats (github.com/nflverse/nflverse-data releases). Prior
// seasons don't change, so this is NOT a weekly cron job — run it manually
// when adding a season, per this repo's existing "no migration runner, run
// manually" convention for one-off data loads (see sql/*.sql headers).
//
// Writes compacted JSON to data/nflverse/ rather than keeping the raw
// multi-decade CSVs, mirroring the data/retrosheet/*.EVA -> data/games.json
// precedent used by the MLB backtest.
//
// NOTE: these release asset URLs/column names are current as of nflreadr's
// well-established schema but were NOT live-verified from this environment
// (outbound access to github.com/ESPN is blocked by this sandbox's egress
// policy). Run this script once with network access (locally or in CI) and
// check the logged column report before trusting the output.
import * as XLSX_NS from "xlsx";
const XLSX = XLSX_NS.default ?? XLSX_NS;
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";

const RELEASE_BASE = "https://github.com/nflverse/nflverse-data/releases/download";
const OUT_DIR = join(process.cwd(), "data/nflverse");

const SEASONS = (() => {
  const args = process.argv.slice(2);
  const seasonsArg = args.find(a => a.startsWith("--seasons="));
  if (seasonsArg) return seasonsArg.split("=")[1].split(",").map(Number);
  const currentYear = new Date().getFullYear();
  // Last 5 completed seasons by default — enough lookback for recency-weighted projections.
  return Array.from({ length: 5 }, (_, i) => currentYear - 1 - i);
})();

async function fetchCsv(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
  const text = await res.text();
  const wb = XLSX.read(text, { type: "string" });
  const sheetName = wb.SheetNames[0];
  return XLSX.utils.sheet_to_json(wb.Sheets[sheetName]);
}

// Expected columns per file, used only to log a warning if nflverse has
// renamed something — parsing still proceeds with whatever columns exist,
// since downstream code (lib/nfl-fantasy/scoring.js, id-map.js) already
// treats missing fields as absent rather than throwing.
const EXPECTED_COLUMNS = {
  player_stats: ["player_id", "player_name", "position", "recent_team", "season", "week", "passing_yards", "passing_tds", "rushing_yards", "rushing_tds", "receptions", "receiving_yards", "receiving_tds"],
  players: ["gsis_id", "espn_id", "display_name", "position"],
  snap_counts: ["pfr_player_id", "player", "position", "team", "season", "week", "offense_pct"],
};

function checkColumns(label, rows) {
  if (!rows.length) {
    console.warn(`[fetch-nflverse] ${label}: 0 rows returned`);
    return;
  }
  const actual = new Set(Object.keys(rows[0]));
  const missing = (EXPECTED_COLUMNS[label] || []).filter(c => !actual.has(c));
  if (missing.length) {
    console.warn(`[fetch-nflverse] ${label}: missing expected columns ${missing.join(", ")} — nflverse may have renamed these. Actual columns: ${[...actual].join(", ")}`);
  } else {
    console.log(`[fetch-nflverse] ${label}: ${rows.length} rows, columns OK`);
  }
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  console.log(`[fetch-nflverse] fetching seasons: ${SEASONS.join(", ")}`);

  // player_stats is published as one release per season under the
  // "player_stats" tag, asset player_stats_<season>.csv.
  const allPlayerStats = [];
  for (const season of SEASONS) {
    try {
      const rows = await fetchCsv(`${RELEASE_BASE}/player_stats/player_stats_${season}.csv`);
      checkColumns("player_stats", rows);
      allPlayerStats.push(...rows);
    } catch (e) {
      console.error(`[fetch-nflverse] season ${season} player_stats failed: ${e.message}`);
    }
  }
  await writeFile(join(OUT_DIR, "player_stats.json"), JSON.stringify(allPlayerStats));
  console.log(`[fetch-nflverse] wrote player_stats.json (${allPlayerStats.length} rows)`);

  // The id crosswalk is a single always-current file, not per-season.
  try {
    const playerRows = await fetchCsv(`${RELEASE_BASE}/players/players.csv`);
    checkColumns("players", playerRows);
    await writeFile(join(OUT_DIR, "players.json"), JSON.stringify(playerRows));
    console.log(`[fetch-nflverse] wrote players.json (${playerRows.length} rows)`);
  } catch (e) {
    console.error(`[fetch-nflverse] players crosswalk failed: ${e.message}`);
  }

  // Snap counts, one release per season, used as a volume/ceiling signal.
  const allSnapCounts = [];
  for (const season of SEASONS) {
    try {
      const rows = await fetchCsv(`${RELEASE_BASE}/snap_counts/snap_counts_${season}.csv`);
      checkColumns("snap_counts", rows);
      allSnapCounts.push(...rows);
    } catch (e) {
      console.error(`[fetch-nflverse] season ${season} snap_counts failed: ${e.message}`);
    }
  }
  await writeFile(join(OUT_DIR, "snap_counts.json"), JSON.stringify(allSnapCounts));
  console.log(`[fetch-nflverse] wrote snap_counts.json (${allSnapCounts.length} rows)`);
}

main().catch(e => {
  console.error("[fetch-nflverse] fatal:", e);
  process.exit(1);
});
