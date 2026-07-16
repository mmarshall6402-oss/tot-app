// lib/backtest/roster.js
//
// Loads Retrosheet .ROS roster files (one per team per season) into a
// single playerId -> { bats, throws } lookup. Batting/throwing handedness
// doesn't change season to season, so a global map (last file wins on
// conflict, which in practice never happens) is simpler and sufficient —
// we don't need team/season scoping for handedness lookups.

import { readdirSync, readFileSync } from "fs";
import { join } from "path";

const RETROSHEET_DIR = "data/retrosheet";

export function loadRosters(dir = join(process.cwd(), RETROSHEET_DIR)) {
  const players = new Map();
  const files = readdirSync(dir).filter(f => f.endsWith(".ROS"));

  for (const file of files) {
    const text = readFileSync(join(dir, file), "utf8");
    for (const rawLine of text.split("\n")) {
      const line = rawLine.trim();
      if (!line) continue;
      const [playerId, , , bats, throws] = line.split(",");
      if (!playerId) continue;
      players.set(playerId, { bats, throws });
    }
  }

  return players;
}
