"use client";

// The shared "Decision Card" — one reusable unit for showing a single pick's
// verdict, confidence, plain-English reasoning, and betting-decision actions.
// Used for the Home hero and "Top 3 Today" list; existing Picks/Steals/NFL
// cards keep their own bespoke markup for now (see AGENTS.md roadmap —
// migrating those onto this component is a later fast-follow, not Phase 1).

import { useState } from "react";
import { translateReasons } from "../lib/reason-labels.js";
import { impliedWinPct } from "../lib/odds-display.js";
import { shouldBetNow } from "../lib/fair-odds.js";
import { tokens } from "../lib/ui-theme.js";
import { CheckIcon } from "./icons.js";

const VERDICT_STYLE = {
  CLEAN: { color: tokens.color.brand, label: "BET" },
  BET:   { color: tokens.color.brand, label: "BET" },
  PASS:  { color: tokens.color.textMuted, label: "PASS" },
  TRAP:  { color: tokens.color.red, label: "TRAP" },
};

const fmtOdds = (o) => (o == null ? "—" : o > 0 ? `+${o}` : `${o}`);

function fmtGameTime(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function Stars({ confidence }) {
  const n = Math.max(0, Math.min(5, Math.round((confidence || 0) / 2)));
  return (
    <span aria-hidden="true" style={{ letterSpacing: 1, fontSize: 13 }}>
      {"★".repeat(n)}
      <span style={{ opacity: 0.25 }}>{"★".repeat(5 - n)}</span>
    </span>
  );
}

// compact: condensed row for lists like "Top 3 Today" — verdict + matchup +
// confidence only, tap to grow into the full card in place.
export default function DecisionCard({ pick, sport = "mlb", S, savePick, saving, compact = false }) {
  const [full, setFull] = useState(!compact);
  const [showAdvanced, setShowAdvanced] = useState(false);

  if (!pick) return null;

  const verdict = VERDICT_STYLE[pick.filter?.verdict] || VERDICT_STYLE.PASS;
  const confidence = pick.filter?.confidence ?? 0;
  const reasons = translateReasons(pick.filter?.confidenceReasons, sport).slice(0, 4);
  const isSaved = saving?.[pick.id] === "saved" || saving?.[pick.id] === "saving";

  const pickOdds = pick.pick === pick.homeTeam ? pick.homeOdds : pick.awayOdds;
  const market = impliedWinPct(pick.homeOdds, pick.awayOdds);
  const marketPct = market ? (pick.pick === pick.homeTeam ? market.home : market.away) : null;
  const betNow = pick.modelProb != null ? shouldBetNow(pickOdds, pick.modelProb / 100) : null;

  if (!full) {
    return (
      <button
        type="button"
        style={{ ...S.card, display: "block", width: "100%", textAlign: "left", fontFamily: "inherit", borderColor: "#242832", padding: "12px 14px", cursor: "pointer" }}
        onClick={() => setFull(true)}
        aria-label={`${pick.pick}${sport === "nfl" ? "" : " ML"} — tap for details`}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <span style={{ fontSize: 11, fontWeight: 800, color: verdict.color, letterSpacing: 0.5, flexShrink: 0 }}>{verdict.label}</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#eee", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {pick.pick} {sport === "nfl" ? "" : "ML"}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            <span style={{ fontSize: 12, fontFamily: "'JetBrains Mono',monospace", color: "#888" }}>{confidence.toFixed(1)}</span>
            <Stars confidence={confidence} />
          </div>
        </div>
      </button>
    );
  }

  return (
    <div style={{ ...S.card, borderColor: `${verdict.color}44`, padding: "18px 18px" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <span style={{ fontSize: 22, fontWeight: 800, color: verdict.color, letterSpacing: 0.5 }}>{verdict.label}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 18, fontWeight: 700 }}>{confidence.toFixed(1)}</span>
          <Stars confidence={confidence} />
        </div>
      </div>

      <div style={{ fontSize: 17, fontWeight: 700, marginTop: 6 }}>
        {pick.pick}{sport === "mlb" ? " ML" : ""}
        <span style={{ fontSize: 12, color: "#666", fontWeight: 400, marginLeft: 8 }}>{fmtOdds(pickOdds)}</span>
      </div>
      <div style={{ fontSize: 12, color: "#666", marginTop: 2 }}>
        {pick.awayTeam} @ {pick.homeTeam} · {fmtGameTime(pick.commenceTime)}
      </div>

      {reasons.length > 0 && (
        <>
          <div style={{ height: 1, background: "#242832", margin: "14px 0" }} />
          <div style={{ fontSize: 11, fontWeight: 700, color: "#999", letterSpacing: 0.5, marginBottom: 8 }}>Why we like it</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {reasons.map((r, i) => (
              <div key={i} style={{ fontSize: 13, color: "#ccc", display: "flex", gap: 8 }}>
                <span style={{ color: r.sign === "-" ? "#D9645C" : "#2FBF71", flexShrink: 0 }}>{r.sign === "-" ? "✗" : "✓"}</span>
                <span>{r.text}</span>
              </div>
            ))}
          </div>
        </>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <button
          style={{
            flex: 1, padding: "10px 14px", borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: isSaved ? "default" : "pointer",
            background: isSaved ? "transparent" : verdict.color, color: isSaved ? verdict.color : "#000",
            border: `1px solid ${verdict.color}`,
          }}
          disabled={isSaved}
          onClick={() => savePick && savePick(pick, sport)}
        >
          {isSaved ? <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><CheckIcon size={13} /> Tracked</span> : "Bet Now"}
        </button>
        <button
          style={{ flex: 1, padding: "10px 14px", borderRadius: 10, fontSize: 13, fontWeight: 700, background: "transparent", border: "1px solid #333947", color: "#ccc", cursor: "pointer" }}
          onClick={() => setShowAdvanced(v => !v)}
        >
          {showAdvanced ? "Hide Details" : "View Game"}
        </button>
      </div>

      {showAdvanced && (
        <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid #242832" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#999", letterSpacing: 0.5, marginBottom: 8 }}>Advanced</div>
          <div style={{ display: "flex", gap: 16, fontSize: 12, color: "#888", marginBottom: betNow ? 12 : 0 }}>
            <span>Model <b style={{ color: "#ccc" }}>{pick.modelProb != null ? `${pick.modelProb}%` : "—"}</b></span>
            <span>Market <b style={{ color: "#ccc" }}>{marketPct != null ? `${marketPct}%` : "—"}</b></span>
            <span>Edge <b style={{ color: "#ccc" }}>{pick.edge != null ? `+${pick.edge.toFixed(1)}%` : "—"}</b></span>
          </div>
          {betNow && (
            <div style={{ background: "#181b22", borderRadius: 10, padding: "10px 12px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ fontSize: 11, color: "#888" }}>
                Current <b style={{ color: "#ccc" }}>{fmtOdds(betNow.currentOdds)}</b> · Fair <b style={{ color: "#ccc" }}>{fmtOdds(betNow.fairOdds)}</b>
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, color: betNow.verdict === "bet" ? "#2FBF71" : "#D6B23D" }}>
                {betNow.verdict === "bet" ? "✅ Bet Now" : "⏳ Wait — price moved"}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
