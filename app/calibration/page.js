"use client";
export const dynamic = "force-dynamic";
import { useEffect, useState } from "react";

const GREEN = "#2FBF71";
const RED = "#D9645C";
const AMBER = "#D6B23D";
const ORANGE = "#D9754A";

function deltaColor(delta) {
  if (delta == null) return "#555";
  if (delta < -10) return RED;
  if (delta > 10) return GREEN;
  return AMBER;
}

export default function FantasyCalibrationPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch("/api/nfl/fantasy/calibration")
      .then((r) => r.json())
      .then((d) => { if (d.error) throw new Error(d.error); setData(d); })
      .catch((e) => setError(e.message || "Could not load calibration data"));
  }, []);

  const th = { fontSize: 10, color: "#555", fontWeight: 700, letterSpacing: 1, padding: "6px 10px", textAlign: "right", whiteSpace: "nowrap" };
  const td = (color) => ({ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: color || "#ccc", padding: "8px 10px", textAlign: "right", borderTop: "1px solid #1c2029" });

  return (
    <div style={{ minHeight: "100vh", background: "#000", color: "#fff", fontFamily: "'Space Grotesk', sans-serif", padding: "40px 24px", maxWidth: 760, margin: "0 auto" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&family=JetBrains+Mono:wght@400;700&display=swap'); *{box-sizing:border-box;} a{color:${ORANGE};}`}</style>
      <a href="/" style={{ fontSize: 13, color: "#444", textDecoration: "none" }}>← Back</a>

      <h1 style={{ fontFamily: "monospace", fontSize: 26, fontWeight: 700, margin: "24px 0 8px" }}>
        T<span style={{ color: "#00FF87" }}>|</span>T Fantasy — Model Calibration
      </h1>
      <p style={{ color: "#888", fontSize: 14, lineHeight: 1.7, marginBottom: 8 }}>
        Every Start/Sit call we make comes with a probability, not just a ranking. This page is the honest check on
        that number: when we say a player has a 63% chance to outscore another, does that actually happen 63% of the
        time? A well-calibrated 60-65% bucket should show an actual win rate somewhere around 60-65% — not 90%, not
        50%. If it drifts, that&apos;s a problem with our model, and it will show up here.
      </p>
      <p style={{ color: "#555", fontSize: 12, lineHeight: 1.6, marginBottom: 32 }}>
        Currently seeded from a backtest against real historical results (the model replayed with only the data it
        would have had at the time) — live Start/Sit calls made through the app are logged going forward and will
        blend into these numbers over time.
      </p>

      {error && (
        <div style={{ color: RED, fontSize: 13 }}>{error}</div>
      )}

      {!error && !data && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#555", fontSize: 13, padding: "20px 0" }}>
          Loading…
        </div>
      )}

      {data && data.total === 0 && (
        <div style={{ background: "#0d0f14", border: "1px solid #242832", borderRadius: 14, padding: "28px 16px", textAlign: "center", color: "#555", fontSize: 13 }}>
          No calibration data yet — run the backtest seed (<code>npm run fantasy-probability-backtest</code>) or start using Start/Sit.
        </div>
      )}

      {data && data.total > 0 && (
        <>
          <div style={{ background: "#0d0f14", border: "1px solid #242832", borderRadius: 12, padding: "14px 16px", marginBottom: 16 }}>
            <div style={{ fontSize: 10, color: "#555", letterSpacing: 1.5, fontWeight: 700, marginBottom: 8 }}>OVERALL BIAS</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 24, fontWeight: 700, color: deltaColor(data.avgDelta) }}>
                {data.avgDelta != null ? `${data.avgDelta > 0 ? "+" : ""}${data.avgDelta}pp` : "—"}
              </span>
              <span style={{ fontSize: 12, color: "#555" }}>
                {data.avgDelta == null ? "" : data.avgDelta < 0 ? "overconfident" : data.avgDelta > 0 ? "underconfident" : "well-calibrated"}
              </span>
            </div>
            <div style={{ fontSize: 11, color: "#3d424f", marginTop: 4 }}>
              {data.total.toLocaleString()} graded head-to-head calls · seasons {data.seasons?.join(", ")} · delta = actual − predicted favorite win rate
            </div>
          </div>

          <div style={{ background: "#0d0f14", border: "1px solid #242832", borderRadius: 12, padding: "14px 16px" }}>
            <div style={{ fontSize: 10, color: "#555", letterSpacing: 1.5, fontWeight: 700, marginBottom: 10 }}>FAVORITE-PROBABILITY CALIBRATION</div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ ...th, textAlign: "left" }}>Predicted range</th>
                    <th style={th}>Avg predicted</th>
                    <th style={th}>Actual win rate</th>
                    <th style={th}>Delta</th>
                    <th style={th}>n</th>
                  </tr>
                </thead>
                <tbody>
                  {data.buckets.map((b) => {
                    const delta = b.actual != null && b.predicted != null ? parseFloat((b.actual - b.predicted).toFixed(1)) : null;
                    return (
                      <tr key={b.label}>
                        <td style={{ ...td("#aaa"), textAlign: "left" }}>{b.label}{b.n > 0 && b.n < 20 ? " *" : ""}</td>
                        <td style={td()}>{b.predicted != null ? `${b.predicted}%` : "—"}</td>
                        <td style={td(b.actual != null ? (b.actual >= (b.predicted || 0) ? GREEN : RED) : "#555")}>{b.actual != null ? `${b.actual}%` : "—"}</td>
                        <td style={td(deltaColor(delta))}>{delta != null ? `${delta > 0 ? "+" : ""}${delta}pp` : "—"}</td>
                        <td style={td(b.n > 0 ? "#666" : "#3d424f")}>{b.n}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ fontSize: 10, color: "#3d424f", marginTop: 10 }}>* n &lt; 20 — too small to interpret</div>
          </div>
        </>
      )}

      <div style={{ marginTop: 40, fontSize: 12, color: "#444" }}>
        <a href="/">← Back to T|T</a>
      </div>
    </div>
  );
}
