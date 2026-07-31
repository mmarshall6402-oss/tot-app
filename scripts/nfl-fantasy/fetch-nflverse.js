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
import { writeFile, mkdir, readFile } from "fs/promises";
import { join } from "path";
import { aggregatePlayByPlay, attachPositions } from "../../lib/nfl-fantasy/pbp-aggregate.js";

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
  const res = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
  const text = await res.text();
  const wb = XLSX.read(text, { type: "string" });
  const sheetName = wb.SheetNames[0];
  return XLSX.utils.sheet_to_json(wb.Sheets[sheetName]);
}

// Play-by-play files run 90MB+ (vs ~1.6MB for one season's aggregated
// stats) — deliberately not parsed through XLSX (see
// lib/nfl-fantasy/csv-columns.js for why), so this returns raw text for the
// column-filtered aggregator to handle instead.
async function fetchText(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(600000) });
  if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
  return res.text();
}

// nflverse's aggregated player_stats rollup sometimes lags behind the raw
// play-by-play for the most recent completed season (confirmed gap for
// 2025: play_by_play_2025.csv exists, player_stats_2025.csv doesn't). When
// the aggregated file 404s, compute the same stat lines ourselves from pbp
// rather than silently losing that season.
//
// These files run 90MB+, which times out over a fetch() on a slow/unreliable
// connection no matter how generous the timeout gets. If a manually
// downloaded copy exists at data/nflverse/raw/play_by_play_<season>.csv
// (e.g. saved via a browser, which retries/resumes far better than a single
// script request), read that instead of hitting the network at all.
async function fetchSeasonViaPbp(season, playersRows) {
  console.log(`[fetch-nflverse] player_stats_${season}.csv unavailable — falling back to play_by_play_${season}.csv`);
  const localPath = join(process.cwd(), "data/nflverse/raw", `play_by_play_${season}.csv`);
  let text;
  try {
    text = await readFile(localPath, "utf8");
    console.log(`[fetch-nflverse] using local copy at ${localPath} instead of fetching over network`);
  } catch {
    text = await fetchText(`${RELEASE_BASE}/pbp/play_by_play_${season}.csv`);
  }
  const aggregated = aggregatePlayByPlay(text);
  const withPositions = attachPositions(aggregated, playersRows);
  console.log(`[fetch-nflverse] aggregated ${withPositions.length} player-week rows from play-by-play for ${season}`);
  return withPositions;
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

  // The id crosswalk is a single always-current file, not per-season —
  // fetched first since the play-by-play fallback below needs it to attach
  // roster position to aggregated stat lines.
  let playerRows = [];
  try {
    playerRows = await fetchCsv(`${RELEASE_BASE}/players/players.csv`);
    checkColumns("players", playerRows);
    await writeFile(join(OUT_DIR, "players.json"), JSON.stringify(playerRows));
    console.log(`[fetch-nflverse] wrote players.json (${playerRows.length} rows)`);
  } catch (e) {
    console.error(`[fetch-nflverse] players crosswalk failed: ${e.message}`);
  }

  // player_stats is published as one release per season under the
  // "player_stats" tag, asset player_stats_<season>.csv. When that's not
  // available yet for a season (seen for 2025: the season's complete and
  // play_by_play_2025.csv exists, but nflverse's aggregated rollup doesn't),
  // fall back to computing it ourselves from play-by-play rather than
  // losing the season outright.
  const allPlayerStats = [];
  for (const season of SEASONS) {
    try {
      const rows = await fetchCsv(`${RELEASE_BASE}/player_stats/player_stats_${season}.csv`);
      checkColumns("player_stats", rows);
      allPlayerStats.push(...rows);
    } catch (e) {
      console.error(`[fetch-nflverse] season ${season} player_stats failed: ${e.message}`);
      try {
        const viaPbp = await fetchSeasonViaPbp(season, playerRows);
        allPlayerStats.push(...viaPbp);
      } catch (pbpErr) {
        console.error(`[fetch-nflverse] season ${season} play-by-play fallback also failed: ${pbpErr.message}`);
      }
    }
  }
  await writeFile(join(OUT_DIR, "player_stats.json"), JSON.stringify(allPlayerStats));
  console.log(`[fetch-nflverse] wrote player_stats.json (${allPlayerStats.length} rows)`);

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
