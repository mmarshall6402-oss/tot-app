"use client";

// 1pp-bin histogram of true edge %, stacked/colored by verdict. Paired with
// a data table below (dataviz accessibility rule — never chart-only).

import { useState } from "react";

const W = 480;
const H = 260;
const PAD = { top: 16, right: 16, bottom: 34, left: 32 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;

const VERDICT_COLOR = { CLEAN: "#00FF87", BET: "#3ddc84", PASS: "#444", TRAP: "#FF4D4D" };
const VERDICT_ORDER = ["CLEAN", "BET", "PASS", "TRAP"];

export default function EdgeHistogram({ rows }) {
  const [hover, setHover] = useState(null);
  const edges = rows.map(r => r.true_edge_pct).filter(v => v != null);
  if (!edges.length) return <div style={{ color: "#444", fontSize: 12 }}>No edge data.</div>;

  const lo = Math.floor(Math.min(...edges));
  const hi = Math.ceil(Math.max(...edges));
  const binCount = Math.max(1, hi - lo);
  const bins = Array.from({ length: binCount }, (_, i) => {
    const binLo = lo + i;
    const binHi = binLo + 1;
    const slice = rows.filter(r => r.true_edge_pct != null && r.true_edge_pct >= binLo && r.true_edge_pct < binHi);
    const byVerdict = Object.fromEntries(VERDICT_ORDER.map(v => [v, slice.filter(r => r.verdict === v).length]));
    return { label: `${binLo}–${binHi}%`, binLo, byVerdict, total: slice.length };
  });

  const maxTotal = Math.max(1, ...bins.map(b => b.total));
  const barW = PLOT_W / bins.length;
  const y = v => PAD.top + PLOT_H - (v / maxTotal) * PLOT_H;

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", background: "#080808", borderRadius: 10 }}>
        <line x1={PAD.left} y1={PAD.top + PLOT_H} x2={W - PAD.right} y2={PAD.top + PLOT_H} stroke="#222" />
        {bins.map((b, i) => {
          let yCursor = PAD.top + PLOT_H;
          return (
            <g key={b.label} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} style={{ cursor: "pointer" }}>
              {VERDICT_ORDER.map(v => {
                const count = b.byVerdict[v];
                if (!count) return null;
                const segH = (count / maxTotal) * PLOT_H;
                yCursor -= segH;
                return (
                  <rect key={v} x={PAD.left + i * barW + 1} y={yCursor} width={Math.max(1, barW - 2)} height={segH}
                    fill={VERDICT_COLOR[v]} opacity={hover === i ? 1 : 0.85} />
                );
              })}
              {i % 2 === 0 && (
                <text x={PAD.left + i * barW + barW / 2} y={PAD.top + PLOT_H + 14} fill="#444" fontSize={8} textAnchor="middle">{b.binLo}</text>
              )}
            </g>
          );
        })}
        {hover != null && (() => {
          const b = bins[hover];
          const tx = Math.min(PAD.left + hover * barW + 8, W - 120);
          return (
            <g>
              <rect x={tx} y={4} width={112} height={16 + VERDICT_ORDER.filter(v => b.byVerdict[v]).length * 12} rx={6} fill="#000" stroke="#222" />
              <text x={tx + 6} y={16} fill="#fff" fontSize={9} fontWeight={700}>{b.label} edge · n={b.total}</text>
              {VERDICT_ORDER.filter(v => b.byVerdict[v]).map((v, j) => (
                <text key={v} x={tx + 6} y={28 + j * 12} fill={VERDICT_COLOR[v]} fontSize={9}>{v}: {b.byVerdict[v]}</text>
              ))}
            </g>
          );
        })()}
      </svg>
      <div style={{ display: "flex", gap: 12, marginTop: 8, flexWrap: "wrap" }}>
        {VERDICT_ORDER.map(v => (
          <div key={v} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "#888" }}>
            <span style={{ width: 10, height: 10, background: VERDICT_COLOR[v], display: "inline-block", borderRadius: 2 }} />
            {v}
          </div>
        ))}
      </div>
    </div>
  );
}
