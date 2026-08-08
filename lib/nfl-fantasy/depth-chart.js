// Groups Sleeper's live player index (lib/nfl-fantasy/sleeper.js) into a
// per-team depth chart: position group -> players ordered by
// depthChartOrder (1 = starter). Sleeper is the only source in this codebase
// that carries real depth-order data (nflverse/ESPN roster data has no
// starter/backup distinction), so a player missing depthChartPosition or
// depthChartOrder just isn't shown — that's Sleeper's own signal that it
// hasn't placed them on the chart yet (practice squad, just-signed, etc.),
// not a bug here.
import { nflTeamFullName } from "../nfl-team-names.js";

// Offense skill positions first (what the rest of the Fantasy tab cares
// about), then O-line, then defense, then special teams. Anything not
// listed falls after these in alphabetical order rather than being dropped
// — Sleeper's position-group taxonomy isn't asserted exhaustively here.
const POSITION_GROUP_ORDER = [
  "QB", "RB", "FB", "WR", "TE",
  "LT", "LG", "C", "RG", "RT", "OT", "OG", "OL",
  "DE", "DT", "NT", "DL",
  "OLB", "ILB", "MLB", "LB",
  "CB", "FS", "SS", "S", "DB",
  "K", "P", "LS", "KR", "PR", "ST",
];

function positionRank(pos) {
  const i = POSITION_GROUP_ORDER.indexOf(pos);
  return i === -1 ? POSITION_GROUP_ORDER.length : i;
}

// sleeperIndex: Map from fetchSleeperPlayerIndex(). team: any abbreviation
// or full name lib/nfl-team-names.js recognizes (e.g. "KC", "Chiefs" won't
// match — pass "Kansas City Chiefs" or an abbreviation).
export function buildDepthChart(sleeperIndex, team) {
  const targetFull = nflTeamFullName(team);
  const players = [...sleeperIndex.values()].filter(
    (p) => p.team && p.depthChartPosition && p.depthChartOrder != null && nflTeamFullName(p.team) === targetFull
  );

  const byPosition = new Map();
  for (const p of players) {
    const arr = byPosition.get(p.depthChartPosition) || [];
    arr.push(p);
    byPosition.set(p.depthChartPosition, arr);
  }

  const positions = [...byPosition.entries()]
    .map(([position, list]) => ({
      position,
      players: list
        .sort((a, b) => a.depthChartOrder - b.depthChartOrder)
        .map((p) => ({
          sleeperId: p.sleeperId,
          espnId: p.espnId,
          name: p.name,
          position: p.position,
          depthChartOrder: p.depthChartOrder,
          injuryStatus: p.injuryStatus,
        })),
    }))
    .sort((a, b) => positionRank(a.position) - positionRank(b.position) || a.position.localeCompare(b.position));

  return { team: targetFull, positions };
}
