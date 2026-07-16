// lib/backtest/retrosheet-parser.js
//
// Parses one Retrosheet event file (.EVA/.EVN — one file per home team per
// season) into a list of per-game records: starting pitchers, and a
// sequential play log with each play attributed to the correct batting/
// defending team and the pitcher actually on the mound at that moment
// (tracked via `start`/`sub` lines with position code 1 = pitcher).
//
// Deliberately does NOT reconstruct full lineups or runner advancement —
// season-stats.js only needs (a) who started as pitcher, (b) who was
// pitching for each play, and (c) each play's batter-outcome classification
// (from retrosheet-events.js), which is sufficient to build point-in-time
// pitching and team-batting features without tracking baserunners.

import { classifyPlay } from "./retrosheet-events.js";

function splitCsvLine(line) {
  return line.split(",");
}

// text: raw contents of one .EVA/.EVN file.
export function parseEventFile(text) {
  const games = [];
  let cur = null;

  const finishGame = () => { if (cur) games.push(cur); cur = null; };

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const fields = splitCsvLine(line);
    const type = fields[0];

    if (type === "id") {
      finishGame();
      const gameId = fields[1];
      // Retrosheet game id: <home team code><YYYYMMDD><game number>
      const date = gameId.slice(3, 11);
      cur = {
        gameId,
        date,
        homeTeamCode: null,
        awayTeamCode: null,
        homeStarterId: null,
        awayStarterId: null,
        currentHomePitcher: null,
        currentAwayPitcher: null,
        plays: [],
      };
      continue;
    }
    if (!cur) continue; // stray lines before first id (shouldn't happen)

    if (type === "info") {
      if (fields[1] === "hometeam") cur.homeTeamCode = fields[2];
      if (fields[1] === "visteam") cur.awayTeamCode = fields[2];
      continue;
    }

    if (type === "start" || type === "sub") {
      const playerId = fields[1];
      const isHome = fields[3] === "1";
      const position = parseInt(fields[5], 10);
      if (position === 1) {
        if (isHome) {
          cur.currentHomePitcher = playerId;
          if (cur.homeStarterId == null) cur.homeStarterId = playerId;
        } else {
          cur.currentAwayPitcher = playerId;
          if (cur.awayStarterId == null) cur.awayStarterId = playerId;
        }
      }
      continue;
    }

    if (type === "play") {
      const inning = parseInt(fields[1], 10);
      const half = fields[2] === "1" ? 1 : 0; // 0 = top (away batting), 1 = bottom (home batting)
      const batterId = fields[3];
      const eventText = fields.slice(6).join(","); // event text may itself contain commas in rare cases; rejoin defensively
      const battingTeam = half === 0 ? "away" : "home";
      const defendingTeam = half === 0 ? "home" : "away";
      const pitcherId = defendingTeam === "home" ? cur.currentHomePitcher : cur.currentAwayPitcher;

      const classified = classifyPlay(eventText || fields[6] || "");
      cur.plays.push({
        inning,
        half,
        battingTeam,
        defendingTeam,
        batterId,
        pitcherId,
        ...classified,
      });
      continue;
    }
  }
  finishGame();

  return games;
}
