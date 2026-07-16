"use client";

// Single-series line+area chart of bankroll over chronological bet index.
// Tier 3 only — always shown with a disclaimer banner naming the real odds
// source (see app/admin/backtest/page.js) since this is the one tier that
// makes an ROI claim at all.

import { useState } from "react";

const W = 480;
const H = 240;
const PAD = { top: 16, right: 16, bottom: 28, left: 44 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;

export default function EquityCurve({ points, startingBankroll }) {
  const [hover, setHover] = useState(null);
  if (!points?.length) return <div style={{ color: "#444", fontSize: 12 }}>No settled bets.</div>;

  const values = points.map(p => p.bankroll);
  const lo = Math.min(startingBankroll, ...values);
  const hi = Math.max(startingBankroll, ...values);
  const pad = Math.max(1, (hi - lo) * 0.1);
  const yMin = lo - pad, yMax = hi + pad;

  const x = i => PAD.left + (points.length === 1 ? 0 : (i / (points.length - 1)) * PLOT_W);
  const y = v => PAD.top + PLOT_H - ((v - yMin) / (yMax - yMin)) * PLOT_H;

  const linePoints = points.map((p, i) => `${x(i)},${y(p.bankroll)}`).join(" ");
  const areaPoints = `${x(0)},${y(startingBankroll)} ${linePoints} ${x(points.length - 1)},${y(startingBankroll)}`;
  const finalUp = points[points.length - 1].bankroll >= startingBankroll;
  const color = finalUp ? "#00FF87" : "#FF4D4D";

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", background: "#080808", borderRadius: 10 }}>
        <line x1={PAD.left} y1={y(startingBankroll)} x2={W - PAD.right} y2={y(startingBankroll)} stroke="#333" strokeDasharray="4 4" />
        <text x={PAD.left - 6} y={y(startingBankroll) + 3} fill="#444" fontSize={8} textAnchor="end">${startingBankroll}</text>
        <polygon points={areaPoints} fill={color} opacity={0.12} />
        <polyline points={linePoints} fill="none" stroke={color} strokeWidth={2} />
        {points.map((p, i) => (
          <circle key={i} cx={x(i)} cy={y(p.bankroll)} r={hover === i ? 4 : 0}
            fill={color} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
            style={{ cursor: "pointer" }} />
        ))}
        {/* invisible wider hit targets for hover */}
        {points.map((p, i) => (
          <rect key={`hit-${i}`} x={x(i) - (PLOT_W / points.length) / 2} y={PAD.top} width={Math.max(2, PLOT_W / points.length)} height={PLOT_H}
            fill="transparent" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} style={{ cursor: "pointer" }} />
        ))}
        {hover != null && (
          <g>
            <rect x={Math.min(x(hover) + 8, W - 130)} y={Math.max(y(points[hover].bankroll) - 34, 4)} width={124} height={30} rx={6} fill="#000" stroke="#222" />
            <text x={Math.min(x(hover) + 8, W - 130) + 8} y={Math.max(y(points[hover].bankroll) - 34, 4) + 13} fill="#fff" fontSize={10} fontWeight={700}>
              {points[hover].date} · ${points[hover].bankroll.toFixed(0)}
            </text>
            <text x={Math.min(x(hover) + 8, W - 130) + 8} y={Math.max(y(points[hover].bankroll) - 34, 4) + 25} fill="#888" fontSize={9}>
              bet #{hover + 1} of {points.length}
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}
