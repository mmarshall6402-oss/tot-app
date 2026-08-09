// Crosswalks nflverse's snap_counts rows — keyed by PFR player id, with no
// gsis_id or espn_id on the file at all (see EXPECTED_COLUMNS in
// nflverse-csv.js) — to our Sleeper-rostered players via normalized name,
// the same name-fallback approach lib/nfl-fantasy/id-map.js already uses
// for the gsis_id/espn_id crosswalk. Feeds the snap-share-delta signal in
// app/api/cron/fantasy-alerts, alongside the depth-chart/injury diff in
// alerts.js.
import { normalizeName } from "./id-map.js";

// snapCountsRows: one season's snap_counts_<season> rows (offense_pct per
// player per week). Groups by normalized name, then by team within that —
// keeping every team a name appeared under that season instead of merging
// on name alone, so an in-season trade doesn't get silently mixed with (or
// mistaken for) a different player who shares that name.
function groupSnapCounts(snapCountsRows) {
  const byName = new Map(); // normalizedName -> Map<team, Array<{week, offensePct}>>
  for (const row of snapCountsRows || []) {
    const key = normalizeName(row.player);
    if (!key) continue;
    if (!byName.has(key)) byName.set(key, new Map());
    const byTeam = byName.get(key);
    const team = row.team || "";
    if (!byTeam.has(team)) byTeam.set(team, []);
    const week = Number(row.week);
    const offensePct = Number(row.offense_pct);
    if (Number.isFinite(week) && Number.isFinite(offensePct)) byTeam.get(team).push({ week, offensePct });
  }
  return byName;
}

// The two most recent weeks of offense_pct for one player, preferring the
// team they're currently rostered under (Sleeper's live team field) but
// falling back to whichever team has the most recent data if that team
// isn't found — covers a trade nflverse's snap_counts hasn't relabeled to
// match Sleeper's already-updated roster team.
function latestTwoWeeks(byTeam, currentTeam) {
  let rows = byTeam.get(currentTeam);
  if (!rows?.length) {
    let bestRows = null, bestWeek = -1;
    for (const candidate of byTeam.values()) {
      const maxWeek = Math.max(...candidate.map((r) => r.week));
      if (maxWeek > bestWeek) { bestWeek = maxWeek; bestRows = candidate; }
    }
    rows = bestRows;
  }
  if (!rows?.length) return null;
  const sorted = [...rows].sort((a, b) => a.week - b.week);
  return sorted.slice(-2);
}

// Returns one entry per rostered player whose offense-snap share moved at
// least thresholdPct percentage points week over week. A player with fewer
// than two weeks of snap data yet (bye week, just activated, not in the
// dataset) is silently skipped rather than reported as a "0 -> X" swing.
export function detectSnapShareChanges(rosterSleeperIds, playerIndex, snapCountsRows, { thresholdPct = 15 } = {}) {
  const grouped = groupSnapCounts(snapCountsRows);
  const changes = [];
  for (const sleeperId of rosterSleeperIds) {
    const player = playerIndex.get(sleeperId);
    if (!player?.name) continue;
    const byTeam = grouped.get(normalizeName(player.name));
    if (!byTeam) continue;
    const lastTwo = latestTwoWeeks(byTeam, player.team);
    if (!lastTwo || lastTwo.length < 2) continue;

    const [prev, latest] = lastTwo;
    const deltaPct = Math.round((latest.offensePct - prev.offensePct) * 100);
    if (Math.abs(deltaPct) < thresholdPct) continue;

    changes.push({
      sleeperId, name: player.name, position: player.position, type: "snap_share",
      from: `${Math.round(prev.offensePct * 100)}% (wk ${prev.week})`,
      to: `${Math.round(latest.offensePct * 100)}% (wk ${latest.week})`,
      deltaPct,
    });
  }
  return changes;
}
