"use client";

// A single Trending Pick — pitcher strikeout or batter home-run prop, styled
// as an Underdog-style Higher/Lower (or Yes/No) pick with a confidence meter
// that fills based on the model's blended probability for the picked side.

import { tokens } from "../lib/ui-theme.js";

const fmtOdds = (o) => (o == null ? "—" : o > 0 ? `+${o}` : `${o}`);

function fmtGameTime(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" });
}

// Red (coin-flip) -> yellow -> brand green (high confidence), so the bar reads
// "how sure" at a glance without needing to read the number.
function confidenceColor(pct) {
  if (pct >= 70) return tokens.color.brand;
  if (pct >= 60) return tokens.color.yellow;
  return tokens.color.red;
}

const MARKET_LABEL = { pitcher_k: "Strikeouts", batter_hr: "Home Run" };
const PICK_LABEL = { higher: "Higher", lower: "Lower", yes: "Yes", no: "No" };

function factorLines(pick) {
  const lines = [];
  if (pick.marketType === "pitcher_k") {
    lines.push(`${pick.lambda?.toFixed(1)} projected Ks vs ${pick.line} line`);
  } else {
    lines.push(`${(pick.lambda * 100)?.toFixed(1)}% projected HR chance this game`);
  }
  lines.push(`${pick.edgePct >= 0 ? "+" : ""}${pick.edgePct.toFixed(1)}% edge vs market`);
  return lines;
}

export default function PropCard({ pick, S }) {
  if (!pick) return null;

  const color = confidenceColor(pick.confidencePct);
  const marketLabel = MARKET_LABEL[pick.marketType] || pick.marketType;
  const pickLabel = PICK_LABEL[pick.pick] || pick.pick;

  return (
    <div style={{ ...S.card, borderColor: `${color}44` }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: tokens.color.textMuted, letterSpacing: 1.5, marginBottom: 4 }}>
            {marketLabel.toUpperCase()} · {pick.team}
          </div>
          <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 15, fontWeight: 700, color: tokens.color.textPrimary }}>
            {pick.player}
          </div>
          <div style={{ fontSize: 12, color: tokens.color.textMuted, marginTop: 2 }}>
            vs {pick.opponent} · {fmtGameTime(pick.commenceTime)}
          </div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color }}>{pickLabel}</div>
          <div style={{ fontSize: 11, color: tokens.color.textMuted }}>
            {pick.line != null ? `${pick.line} · ` : ""}{fmtOdds(pick.odds)}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: tokens.color.textMuted, marginBottom: 4 }}>
          <span>CONFIDENCE</span>
          <span style={{ color, fontWeight: 700 }}>{pick.confidencePct}%</span>
        </div>
        <div style={{ height: 6, borderRadius: 3, background: tokens.color.surfaceRaised, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${Math.max(4, Math.min(100, pick.confidencePct))}%`, background: color, transition: "width .3s ease" }} />
        </div>
      </div>

      <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 3 }}>
        {factorLines(pick).map((line, i) => (
          <div key={i} style={{ fontSize: 12, color: tokens.color.textSecondary }}>{line}</div>
        ))}
      </div>
    </div>
  );
}
