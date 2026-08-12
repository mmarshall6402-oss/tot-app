"use client";

import { impliedWinPct, oddsMovement } from "../lib/odds-display.js";
import { tokens } from "../lib/ui-theme.js";

// Devigged win % for both teams, plus an open→current movement arrow when
// opening odds were captured for this pick. Renders nothing without odds.
// Shared by the MLB (app/page.js) and NFL (components/NFLSection.js) pick
// cards — previously two byte-identical copies that had already drifted once.
export default function WinPctRow({ homeTeam, awayTeam, homeOdds, awayOdds, openHomeOdds, openAwayOdds }) {
  const wp = impliedWinPct(homeOdds, awayOdds);
  if (!wp) return null;
  const move = oddsMovement(openHomeOdds, homeOdds, openAwayOdds, awayOdds);
  const arrow = move?.direction === "up" ? "▲" : move?.direction === "down" ? "▼" : null;
  const arrowColor = move?.direction === "up" ? "#2FBF71" : move?.direction === "down" ? "#D9645C" : "#555";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 6, fontSize: 11, fontFamily: tokens.font.mono }}>
      <span style={{ color: "#666" }}>{(awayTeam || "").split(" ").pop()} <b style={{ color: "#bbb" }}>{wp.away}%</b></span>
      <span style={{ color: "#3d424f" }}>·</span>
      <span style={{ color: "#666" }}>{(homeTeam || "").split(" ").pop()} <b style={{ color: "#bbb" }}>{wp.home}%</b></span>
      {arrow && (
        <span style={{ color: arrowColor }}>{arrow} {move.delta}% since open</span>
      )}
    </div>
  );
}
