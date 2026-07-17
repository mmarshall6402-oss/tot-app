"use client";

// "Why not to bet" — the counterpart to DecisionCard's hero/hits. Surfaces
// the games the model skipped (PASS/TRAP) and the top reason for each, using
// data lib/filter.js and lib/filter-nfl.js already compute (failures[],
// trueEdgeFrac, signalAgreement) — no new backend/model work.

import { useState } from "react";
import { tokens } from "../lib/ui-theme.js";

const VERDICT_TAG = {
  PASS: { color: tokens.color.textMuted, label: "PASS" },
  TRAP: { color: tokens.color.red, label: "TRAP" },
};

const MAX_ROWS = 8;

// TRAP can fire purely from the edge/agreement override (lib/filter.js:588,
// :628) with zero AND-gate failures, so failures[] alone isn't always enough.
function skipReason(f) {
  if (f?.failures?.length > 0) return f.failures[0];
  if (f?.trueEdgeFrac < 0) return "Model's fair line disagrees with the market here";
  if (f?.signalAgreement?.normalized != null && f.signalAgreement.normalized < 0.4) return "Signals disagree on this pick";
  return "Model flagged this as a trap";
}

// picks: [{ p, sport }] — every PASS/TRAP game not already shown as the hero.
export default function SkipSummary({ picks }) {
  const [expanded, setExpanded] = useState(false);

  if (!picks || picks.length === 0) return null;

  const shown = expanded ? picks.slice(0, MAX_ROWS) : [];
  const hiddenCount = picks.length - shown.length;

  return (
    <div style={{ background: "rgba(214,178,61,0.04)", border: "1px solid rgba(214,178,61,0.12)", borderRadius: 10, padding: "12px 14px" }}>
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", background: "transparent", border: "none", padding: 0, cursor: "pointer", textAlign: "left", fontFamily: "inherit" }}
      >
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#D6B23D" }}>
            {picks.length} other game{picks.length === 1 ? "" : "s"} skipped today
          </div>
          <div style={{ fontSize: 11, color: "#555", marginTop: 2 }}>Skipping is the correct play — tap to see why</div>
        </div>
        <span style={{ fontSize: 11, color: "#D6B23D", flexShrink: 0, marginLeft: 8 }}>{expanded ? "Hide" : "Show"}</span>
      </button>

      {expanded && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12, paddingTop: 12, borderTop: "1px solid rgba(214,178,61,0.12)" }}>
          {shown.map(({ p, sport }) => {
            const tag = VERDICT_TAG[p.filter?.verdict] || VERDICT_TAG.PASS;
            return (
              <div key={`${sport}-${p.id}`} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 10, fontWeight: 800, color: tag.color, letterSpacing: 0.5 }}>{tag.label}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#ccc" }}>{p.awayTeam} @ {p.homeTeam}</span>
                </div>
                <div style={{ fontSize: 11, color: "#777" }}>{skipReason(p.filter)}</div>
              </div>
            );
          })}
          {hiddenCount > 0 && (
            <div style={{ fontSize: 11, color: "#555" }}>+{hiddenCount} more</div>
          )}
        </div>
      )}
    </div>
  );
}
