"use client";

// Reliability diagram: predicted probability (x) vs actual win rate (y),
// bucketed, with a dashed y=x reference line (perfect calibration). Supports
// multiple series (e.g. raw model vs isotonic-recalibrated) so before/after
// can be compared on one chart. Always paired with a data table below —
// never chart-only, per this app's dataviz convention.

import { useState } from "react";

const W = 480;
const H = 320;
const PAD = { top: 16, right: 16, bottom: 36, left: 40 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;

const x = v => PAD.left + v * PLOT_W;
const y = v => PAD.top + (1 - v) * PLOT_H;

export default function CalibrationChart({ series }) {
  const [hover, setHover] = useState(null);
  const populated = series.map(s => ({ ...s, buckets: s.buckets.filter(b => b.n > 0) }));

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", background: "#080808", borderRadius: 10 }}>
        {/* axes */}
        <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(0)} stroke="#222" strokeWidth={1} />
        <line x1={x(0)} y1={y(0)} x2={x(0)} y2={y(1)} stroke="#222" strokeWidth={1} />
        {[0, 0.25, 0.5, 0.75, 1].map(t => (
          <g key={t}>
            <text x={x(t)} y={y(0) + 16} fill="#444" fontSize={9} textAnchor="middle" fontFamily="JetBrains Mono, monospace">{Math.round(t * 100)}%</text>
            <text x={x(0) - 8} y={y(t) + 3} fill="#444" fontSize={9} textAnchor="end" fontFamily="JetBrains Mono, monospace">{Math.round(t * 100)}%</text>
          </g>
        ))}
        <text x={W / 2} y={H - 4} fill="#555" fontSize={10} textAnchor="middle">Predicted probability</text>
        <text x={12} y={H / 2} fill="#555" fontSize={10} textAnchor="middle" transform={`rotate(-90 12 ${H / 2})`}>Actual win rate</text>

        {/* perfect-calibration reference */}
        <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} stroke="#333" strokeWidth={1} strokeDasharray="4 4" />

        {/* series */}
        {populated.map((s, si) => (
          <g key={s.name}>
            <polyline
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              points={s.buckets.map(b => `${x(b.predicted)},${y(b.actual)}`).join(" ")}
            />
            {s.buckets.map(b => (
              <circle
                key={`${si}-${b.label}`}
                cx={x(b.predicted)}
                cy={y(b.actual)}
                r={hover === `${si}-${b.label}` ? 6 : 4}
                fill={s.color}
                stroke="#000"
                strokeWidth={1}
                onMouseEnter={() => setHover(`${si}-${b.label}`)}
                onMouseLeave={() => setHover(null)}
                style={{ cursor: "pointer" }}
              />
            ))}
          </g>
        ))}

        {/* tooltip */}
        {populated.map((s, si) => s.buckets.map(b => {
          if (hover !== `${si}-${b.label}`) return null;
          const tx = Math.min(x(b.predicted) + 8, W - 130);
          const ty = Math.max(y(b.actual) - 34, 4);
          return (
            <g key={`tip-${si}-${b.label}`}>
              <rect x={tx} y={ty} width={126} height={40} rx={6} fill="#000" stroke="#222" />
              <text x={tx + 8} y={ty + 15} fill="#fff" fontSize={10} fontWeight={700}>{s.name} · {b.label}</text>
              <text x={tx + 8} y={ty + 29} fill="#888" fontSize={9}>n={b.n} · actual {Math.round(b.actual * 100)}%</text>
            </g>
          );
        }))}
      </svg>

      {/* legend */}
      <div style={{ display: "flex", gap: 14, marginTop: 8, flexWrap: "wrap" }}>
        {series.map(s => (
          <div key={s.name} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "#888" }}>
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: s.color, display: "inline-block" }} />
            {s.name}
          </div>
        ))}
        <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "#555" }}>
          <span style={{ width: 14, height: 0, borderTop: "1px dashed #444", display: "inline-block" }} />
          Perfect calibration (y = x)
        </div>
      </div>

      {/* data table */}
      {series.map(s => (
        <div key={`table-${s.name}`} style={{ marginTop: 14 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#444", letterSpacing: 1, marginBottom: 6 }}>{s.name.toUpperCase()}</div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <thead>
              <tr style={{ color: "#444", textAlign: "left" }}>
                <th style={{ padding: "4px 8px", fontWeight: 600 }}>Bucket</th>
                <th style={{ padding: "4px 8px", fontWeight: 600 }}>Predicted</th>
                <th style={{ padding: "4px 8px", fontWeight: 600 }}>Actual</th>
                <th style={{ padding: "4px 8px", fontWeight: 600 }}>95% CI</th>
                <th style={{ padding: "4px 8px", fontWeight: 600 }}>n</th>
              </tr>
            </thead>
            <tbody>
              {s.buckets.filter(b => b.n > 0).map(b => (
                <tr key={b.label} style={{ borderTop: "1px solid #111" }}>
                  <td style={{ padding: "4px 8px", color: "#888" }}>{b.label}</td>
                  <td style={{ padding: "4px 8px", color: "#888" }}>{(b.predicted * 100).toFixed(1)}%</td>
                  <td style={{ padding: "4px 8px", color: "#fff", fontWeight: 700 }}>{(b.actual * 100).toFixed(1)}%</td>
                  <td style={{ padding: "4px 8px", color: "#555" }}>{b.ciLo != null ? `${(b.ciLo * 100).toFixed(0)}–${(b.ciHi * 100).toFixed(0)}%` : "—"}</td>
                  <td style={{ padding: "4px 8px", color: "#555" }}>{b.n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
