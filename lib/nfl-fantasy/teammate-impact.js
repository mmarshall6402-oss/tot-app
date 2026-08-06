// Flags teammates who compete for the same touches/targets as a player whose
// injury status just worsened — a real backup RB or WR2 sees more volume
// once the player ahead of him is out, but nothing upstream in this app
// models that shift. Same "documented, accepted-risk heuristic" posture as
// schedule-adjustment.js/personnel-adjustment.js: there's no historical data
// to backtest a specific target-share-shift number against, so this only
// ever produces a qualitative alert (a note), never a point adjustment to
// projections/rankings.
//
// QB has no analog here (a team runs one starting QB; a backup QB isn't a
// "usage shift" story the way a backup RB/WR is) so it's excluded from the
// position groups below.
import { STATUS_MULTIPLIER } from "./injury.js";

// Reuses injury.js's status vocabulary, but only the tier worth surfacing as
// an opportunity alert — "questionable" is too common/noisy (most weeks
// several players carry it) to flag every time.
const WORSENING_STATUSES = new Set(
  Object.keys(STATUS_MULTIPLIER).filter((status) => status !== "questionable")
);

const POSITION_GROUP = { RB: "backfield", WR: "pass_catcher", TE: "pass_catcher" };

function normalizeStatus(status) {
  return (status || "").toLowerCase().trim();
}

// transitions: rows from nfl_fantasy_injury_log (espn_id, name, team,
// position, old_status, new_status). playerIndexRows: current player_index
// rows (sport='nfl') for teammate lookup by team+position. depthChartByEspnId
// (optional): Map from Sleeper's depthChartOrder, used only to sort the
// flagged teammates so the direct backup surfaces first — omitting it still
// produces correct alerts, just unordered.
export function computeTeammateImpacts(transitions, playerIndexRows, { depthChartByEspnId } = {}) {
  const alerts = [];
  const byTeam = new Map();
  for (const row of playerIndexRows || []) {
    if (!row.team) continue;
    const list = byTeam.get(row.team) || [];
    list.push(row);
    byTeam.set(row.team, list);
  }

  for (const t of transitions || []) {
    const group = POSITION_GROUP[t.position];
    if (!group || !WORSENING_STATUSES.has(normalizeStatus(t.new_status))) continue;
    if (WORSENING_STATUSES.has(normalizeStatus(t.old_status))) continue; // already-injured -> still-injured isn't new news

    const teammates = (byTeam.get(t.team) || [])
      .filter((p) => POSITION_GROUP[p.position] === group && String(p.player_id ?? p.id) !== String(t.espn_id))
      .filter((p) => !WORSENING_STATUSES.has(normalizeStatus(p.injury_status ?? p.injuryStatus)));

    if (depthChartByEspnId) {
      teammates.sort((a, b) => {
        const da = depthChartByEspnId.get(String(a.player_id ?? a.id)) ?? 99;
        const db = depthChartByEspnId.get(String(b.player_id ?? b.id)) ?? 99;
        return da - db;
      });
    }

    for (const teammate of teammates.slice(0, 2)) {
      alerts.push({
        affectedEspnId: String(teammate.player_id ?? teammate.id),
        affectedName: teammate.name,
        affectedPosition: teammate.position,
        team: t.team,
        injuredName: t.name,
        injuredStatus: t.new_status,
        note: `${t.name} (${t.position}) listed ${t.new_status} — possible usage bump for ${teammate.name}`,
      });
    }
  }

  return alerts;
}
