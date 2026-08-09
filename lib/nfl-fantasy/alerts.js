// Diffs a roster's players against last week's stored role snapshot
// (nfl_fantasy_role_snapshots) to find depth-chart or injury-status
// changes worth telling a user about. This is the detection logic only —
// app/api/cron/fantasy-alerts owns fetching rosters, sending email, and
// writing the new snapshot after.
//
// A player with no prior snapshot (first time we've ever seen them) never
// produces a change — that's the bootstrap week for that player, not a
// real move, so it stays silent rather than reporting every rostered
// player as "new" the first time the cron runs.
export function detectRoleChanges(rosterSleeperIds, playerIndex, previousSnapshots) {
  const changes = [];
  for (const sleeperId of rosterSleeperIds) {
    const current = playerIndex.get(sleeperId);
    const prev = previousSnapshots.get(sleeperId);
    if (!current || !prev) continue;

    if (current.injuryStatus !== prev.injury_status) {
      changes.push({
        sleeperId, name: current.name, position: current.position, type: "injury",
        from: prev.injury_status || "Healthy", to: current.injuryStatus || "Healthy",
      });
    }

    if (
      current.depthChartOrder != null && prev.depth_chart_order != null &&
      current.depthChartOrder !== prev.depth_chart_order
    ) {
      changes.push({
        sleeperId, name: current.name, position: current.position, type: "depth_chart",
        from: `${prev.depth_chart_position || current.position}${prev.depth_chart_order}`,
        to: `${current.depthChartPosition || current.position}${current.depthChartOrder}`,
      });
    }
  }
  return changes;
}

// Snapshot rows to upsert after a run — every rostered player we actually
// looked at, so next week's diff has something to compare against.
export function buildSnapshotRows(rosterSleeperIds, playerIndex) {
  const rows = [];
  for (const sleeperId of rosterSleeperIds) {
    const p = playerIndex.get(sleeperId);
    if (!p) continue;
    rows.push({
      sleeper_id: sleeperId,
      depth_chart_position: p.depthChartPosition,
      depth_chart_order: p.depthChartOrder,
      injury_status: p.injuryStatus,
      snapshot_at: new Date().toISOString(),
    });
  }
  return rows;
}
