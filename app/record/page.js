"use client";
import { useState, useEffect } from "react";
import { SHARED_BUTTON_CSS, FONT_IMPORT_URL, tokens } from "../../lib/ui-theme.js";

const BREAK_EVEN = 52.4; // win rate needed to profit against standard -110 vig

// ─── Calibration curve: predicted probability vs actual win rate, with a
// y=x reference for "perfect calibration." Single data series (the actual-rate
// line) plus a muted reference guide, so no legend is needed — the guide is
// labeled directly.
function CalibrationChart({ buckets }) {
  const [hover, setHover] = useState(null);
  const points = buckets.filter(b => b.n > 0 && b.predicted != null);
  if (points.length < 2) return <div style={{ color: tokens.color.textMuted, fontSize: 13 }}>Not enough settled picks yet to plot a calibration curve.</div>;

  const W = 520, H = 280;
  const PAD = { top: 16, right: 20, bottom: 32, left: 44 };
  const PLOT_W = W - PAD.left - PAD.right;
  const PLOT_H = H - PAD.top - PAD.bottom;

  const allVals = points.flatMap(b => [b.predicted, b.actual]);
  const lo = Math.min(50, ...allVals);
  const hi = Math.max(70, ...allVals);
  const x = v => PAD.left + ((v - lo) / (hi - lo)) * PLOT_W;
  const y = v => PAD.top + PLOT_H - ((v - lo) / (hi - lo)) * PLOT_H;

  const linePoints = points.map(b => `${x(b.predicted)},${y(b.actual)}`).join(" ");

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", background: tokens.color.surfaceRaised, borderRadius: 10 }}>
        {/* axis ticks */}
        {[50, 55, 60, 65, 70].filter(t => t >= lo && t <= hi).map(t => (
          <g key={`x${t}`}>
            <line x1={x(t)} y1={PAD.top} x2={x(t)} y2={PAD.top + PLOT_H} stroke={tokens.color.border} strokeWidth={1} />
            <text x={x(t)} y={H - 10} fill={tokens.color.textMuted} fontSize={9} textAnchor="middle">{t}%</text>
          </g>
        ))}
        {[50, 55, 60, 65, 70].filter(t => t >= lo && t <= hi).map(t => (
          <text key={`y${t}`} x={PAD.left - 8} y={y(t) + 3} fill={tokens.color.textMuted} fontSize={9} textAnchor="end">{t}%</text>
        ))}

        {/* perfect-calibration reference line */}
        <line x1={x(lo)} y1={y(lo)} x2={x(hi)} y2={y(hi)} stroke={tokens.color.textMuted} strokeWidth={1} strokeDasharray="3 4" />
        <text x={x(hi) - 4} y={y(hi) - 6} fill={tokens.color.textMuted} fontSize={9} textAnchor="end">perfect calibration</text>

        {/* actual-rate line */}
        <polyline points={linePoints} fill="none" stroke={tokens.color.brand} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />

        {points.map((b, i) => (
          <g key={i}>
            <circle cx={x(b.predicted)} cy={y(b.actual)} r={hover === i ? 6 : 4} fill={tokens.color.brand} stroke={tokens.color.surfaceRaised} strokeWidth={2} />
            <rect x={x(b.predicted) - 16} y={PAD.top} width={32} height={PLOT_H} fill="transparent"
              onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} style={{ cursor: "pointer" }} />
          </g>
        ))}

        {hover != null && (() => {
          const b = points[hover];
          const bx = Math.min(x(b.predicted) + 10, W - 150);
          const by = Math.max(y(b.actual) - 46, 4);
          return (
            <g>
              <rect x={bx} y={by} width={140} height={40} rx={6} fill={tokens.color.bg} stroke={tokens.color.border} />
              <text x={bx + 8} y={by + 15} fill={tokens.color.textPrimary} fontSize={10} fontWeight={700}>{b.label} predicted</text>
              <text x={bx + 8} y={by + 28} fill={tokens.color.textSecondary} fontSize={10}>Actual {b.actual}% · n={b.n}</text>
            </g>
          );
        })()}
      </svg>
    </div>
  );
}

// ─── Cumulative net record (wins − losses) over time. One series, so no
// legend — title + axis carry the meaning. This is the "losing stretches
// included" chart: every drawdown in the model's record is visible, not
// smoothed away.
function NetRecordCurve({ points }) {
  const [hover, setHover] = useState(null);
  if (!points?.length) return <div style={{ color: tokens.color.textMuted, fontSize: 13 }}>No settled picks yet.</div>;

  const W = 520, H = 220;
  const PAD = { top: 16, right: 16, bottom: 24, left: 40 };
  const PLOT_W = W - PAD.left - PAD.right;
  const PLOT_H = H - PAD.top - PAD.bottom;

  const values = points.map(p => p.cumulative);
  const lo = Math.min(0, ...values);
  const hi = Math.max(0, ...values);
  const pad = Math.max(1, (hi - lo) * 0.15);
  const yMin = lo - pad, yMax = hi + pad;

  const x = i => PAD.left + (points.length === 1 ? 0 : (i / (points.length - 1)) * PLOT_W);
  const y = v => PAD.top + PLOT_H - ((v - yMin) / (yMax - yMin)) * PLOT_H;

  const linePts = points.map((p, i) => `${x(i)},${y(p.cumulative)}`).join(" ");
  const areaPts = `${x(0)},${y(0)} ${linePts} ${x(points.length - 1)},${y(0)}`;
  const finalUp = points[points.length - 1].cumulative >= 0;
  const color = finalUp ? tokens.color.brand : tokens.color.red;

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", background: tokens.color.surfaceRaised, borderRadius: 10 }}>
        <line x1={PAD.left} y1={y(0)} x2={W - PAD.right} y2={y(0)} stroke={tokens.color.border} strokeWidth={1} />
        <text x={PAD.left - 6} y={y(0) + 3} fill={tokens.color.textMuted} fontSize={9} textAnchor="end">0</text>
        <polygon points={areaPts} fill={color} opacity={0.1} />
        <polyline points={linePts} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        {points.map((p, i) => (
          <rect key={i} x={x(i) - (PLOT_W / points.length) / 2} y={PAD.top} width={Math.max(2, PLOT_W / points.length)} height={PLOT_H}
            fill="transparent" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} style={{ cursor: "pointer" }} />
        ))}
        {hover != null && (
          <circle cx={x(hover)} cy={y(points[hover].cumulative)} r={4} fill={color} stroke={tokens.color.surfaceRaised} strokeWidth={2} />
        )}
        {hover != null && (() => {
          const p = points[hover];
          const bx = Math.min(x(hover) + 8, W - 150);
          const by = Math.max(y(p.cumulative) - 44, 4);
          return (
            <g>
              <rect x={bx} y={by} width={140} height={38} rx={6} fill={tokens.color.bg} stroke={tokens.color.border} />
              <text x={bx + 8} y={by + 15} fill={tokens.color.textPrimary} fontSize={10} fontWeight={700}>{p.date}</text>
              <text x={bx + 8} y={by + 28} fill={tokens.color.textSecondary} fontSize={10}>
                {p.wins}-{p.losses}{p.pushes ? `-${p.pushes}` : ""} that day · net {p.cumulative >= 0 ? "+" : ""}{p.cumulative}
              </text>
            </g>
          );
        })()}
      </svg>
    </div>
  );
}

// ─── Single-hue horizontal bar comparison (win rate by tier/verdict).
// Magnitude, not identity — one hue throughout, values direct-labeled,
// break-even shown as a labeled reference line rather than a second color.
function BarRow({ label, sub, pct, n, maxPct }) {
  const width = pct == null ? 0 : Math.max(2, (pct / maxPct) * 100);
  const breakEvenPos = Math.min(98, (BREAK_EVEN / maxPct) * 100);
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 5 }}>
        <span style={{ color: tokens.color.textPrimary, fontWeight: 600 }}>{label} <span style={{ color: tokens.color.textMuted, fontWeight: 400 }}>{sub}</span></span>
        <span style={{ color: tokens.color.textSecondary, fontFamily: tokens.font.mono }}>{pct != null ? `${pct}%` : "—"} <span style={{ color: tokens.color.textMuted }}>(n={n})</span></span>
      </div>
      <div style={{ position: "relative", height: 10, background: tokens.color.surface, borderRadius: 5, overflow: "hidden" }}>
        <div style={{ width: `${width}%`, height: "100%", background: tokens.color.brand, borderRadius: 5, transition: "width .4s ease" }} />
        <div style={{ position: "absolute", left: `${breakEvenPos}%`, top: 0, bottom: 0, width: 1, borderLeft: `1px dashed ${tokens.color.textMuted}` }} />
      </div>
    </div>
  );
}

export default function RecordPage() {
  const [record, setRecord] = useState(null);
  const [calibration, setCalibration] = useState(null);
  const [daily, setDaily] = useState(null);

  useEffect(() => {
    fetch("/api/model-record").then(r => r.json()).then(setRecord).catch(() => {});
    fetch("/api/calibration").then(r => r.json()).then(setCalibration).catch(() => {});
    fetch("/api/daily-record").then(r => r.json()).then(setDaily).catch(() => {});
  }, []);

  const netPoints = (() => {
    if (!daily || daily.error) return [];
    const dates = Object.keys(daily).sort();
    let cum = 0;
    return dates
      .filter(d => (daily[d].wins || 0) + (daily[d].losses || 0) + (daily[d].pushes || 0) > 0)
      .map(d => {
        const { wins = 0, losses = 0, pushes = 0 } = daily[d];
        cum += wins - losses;
        return { date: d, wins, losses, pushes, cumulative: cum };
      });
  })();

  const overconfident = calibration?.avgDelta != null && calibration.avgDelta < 0;
  const deltaAbs = calibration?.avgDelta != null ? Math.abs(calibration.avgDelta) : null;

  const tierMax = Math.max(52.4, ...(record?.byTier || []).map(t => t.pct || 0));
  const verdictMax = Math.max(52.4, ...(calibration?.verdictBuckets || []).map(v => v.actual || 0));

  return (
    <div style={{ minHeight: "100vh", background: tokens.color.bg, fontFamily: tokens.font.body, color: tokens.color.textPrimary, overflowX: "hidden" }}>
      <style>{`
        @import url('${FONT_IMPORT_URL}');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        h1, h2, h3 { font-family: ${tokens.font.display}; }
        a { text-decoration: none; }
        table { border-collapse: collapse; width: 100%; }
        th, td { text-align: left; padding: 8px 10px; font-size: 12px; font-variant-numeric: tabular-nums; }
        th { color: ${tokens.color.textMuted}; font-weight: 600; border-bottom: 1px solid ${tokens.color.border}; }
        td { color: ${tokens.color.textSecondary}; border-bottom: 1px solid ${tokens.color.border}; }
        ${SHARED_BUTTON_CSS}
      `}</style>

      <nav style={{ position: "sticky", top: 0, zIndex: 100, background: "rgba(11,12,16,0.9)", backdropFilter: "blur(20px)", borderBottom: `1px solid ${tokens.color.border}`, padding: "14px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", maxWidth: 1000, margin: "0 auto" }}>
        <a href="/" style={{ fontFamily: tokens.font.mono, fontSize: 18, fontWeight: 700, letterSpacing: -0.5, color: tokens.color.textPrimary }}>
          T<span style={{ color: tokens.color.brand }}>|</span>T
        </a>
        <a href="/landing" className="ghost-btn" style={{ fontSize: 13, padding: "9px 20px" }}>Pricing →</a>
      </nav>

      <section style={{ padding: "64px 24px 40px", maxWidth: 760, margin: "0 auto", textAlign: "center" }}>
        <h1 style={{ fontSize: "clamp(32px,6vw,52px)", fontWeight: 600, letterSpacing: -0.5, lineHeight: 1.15, marginBottom: 16 }}>The Record</h1>
        <p style={{ color: tokens.color.textSecondary, fontSize: 15, lineHeight: 1.6, maxWidth: 540, margin: "0 auto" }}>
          Every graded pick since we started tracking — including the losing stretches.
          No cherry-picked hot streaks, no deleted bad weeks.
        </p>
      </section>

      {/* ─── Headline stats ─────────────────────────── */}
      <section style={{ padding: "0 24px 56px", maxWidth: 900, margin: "0 auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
          {[
            { label: "Win rate", value: record?.pct != null ? `${record.pct}%` : "—" },
            { label: "Record", value: record?.total != null ? `${record.wins}-${record.losses}${record.pushes ? `-${record.pushes}` : ""}` : "—" },
            { label: "Picks graded", value: record?.total != null ? `${record.total}` : "—" },
            { label: "Avg edge", value: record?.avgEdge != null ? `+${record.avgEdge}%` : "—" },
            { label: "Break-even needed", value: `${BREAK_EVEN}%` },
          ].map(({ label, value }) => (
            <div key={label} style={{ background: tokens.color.surface, border: `1px solid ${tokens.color.border}`, borderRadius: 14, padding: "18px 16px", textAlign: "center" }}>
              <div style={{ fontFamily: tokens.font.mono, fontSize: 24, fontWeight: 700 }}>{value}</div>
              <div style={{ fontSize: 11, color: tokens.color.textMuted, marginTop: 4, letterSpacing: 0.5 }}>{label.toUpperCase()}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ─── Honesty section: calibration ──────────────── */}
      <section style={{ padding: "0 24px 64px", maxWidth: 760, margin: "0 auto" }}>
        <h2 style={{ fontSize: "clamp(22px,4vw,30px)", fontWeight: 600, marginBottom: 10 }}>How wrong are we, exactly?</h2>
        <p style={{ color: tokens.color.textSecondary, fontSize: 14, lineHeight: 1.6, marginBottom: 24, maxWidth: 560 }}>
          {calibration?.avgDelta != null
            ? <>Across settled picks, when the model says a team wins X% of the time, that team actually wins <strong style={{ color: tokens.color.textPrimary }}>
                {deltaAbs}pt {overconfident ? "less" : "more"}</strong> often than X — the model runs {overconfident ? "overconfident" : "underconfident"} by that margin.
                We show this instead of hiding it, and we recalibrate against it.</>
            : "Not enough settled picks yet to compute a calibration gap."}
        </p>
        <CalibrationChart buckets={calibration?.probBuckets || []} />
        {calibration?.probBuckets?.some(b => b.n > 0) && (
          <div style={{ overflowX: "auto", marginTop: 16 }}>
            <table>
              <thead><tr><th>Predicted</th><th>Actual</th><th>Picks</th><th>Delta</th></tr></thead>
              <tbody>
                {calibration.probBuckets.filter(b => b.n > 0).map(b => (
                  <tr key={b.label}>
                    <td>{b.label}</td>
                    <td>{b.actual}%</td>
                    <td>{b.n}</td>
                    <td>{b.actual != null && b.predicted != null ? `${(b.actual - b.predicted) >= 0 ? "+" : ""}${(b.actual - b.predicted).toFixed(1)}pt` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ─── Net record over time ──────────────────────── */}
      <section style={{ padding: "0 24px 64px", maxWidth: 760, margin: "0 auto" }}>
        <h2 style={{ fontSize: "clamp(22px,4vw,30px)", fontWeight: 600, marginBottom: 10 }}>Every day, including the bad ones</h2>
        <p style={{ color: tokens.color.textSecondary, fontSize: 14, lineHeight: 1.6, marginBottom: 24, maxWidth: 560 }}>
          Cumulative wins minus losses across every graded pick, in order. Drawdowns are part of the record, not edited out.
        </p>
        <NetRecordCurve points={netPoints} />
      </section>

      {/* ─── Tier + verdict breakdown ──────────────────── */}
      <section style={{ padding: "0 24px 80px", maxWidth: 760, margin: "0 auto", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 40 }}>
        <div>
          <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>Hit rate by confidence tier</h3>
          <p style={{ color: tokens.color.textMuted, fontSize: 12, marginBottom: 18 }}>Dashed line = {BREAK_EVEN}% break-even</p>
          {(record?.byTier || []).map(t => (
            <BarRow key={t.tier} label={t.tier} sub="" pct={t.pct} n={t.total} maxPct={tierMax} />
          ))}
        </div>
        <div>
          <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>Hit rate by verdict</h3>
          <p style={{ color: tokens.color.textMuted, fontSize: 12, marginBottom: 18 }}>CLEAN should outperform BET — if it doesn't, the filter isn't earning its keep.</p>
          {(calibration?.verdictBuckets || []).map(v => (
            <BarRow key={v.label} label={v.label} sub="" pct={v.actual} n={v.n} maxPct={verdictMax} />
          ))}
        </div>
      </section>

      <footer style={{ borderTop: `1px solid ${tokens.color.border}`, padding: "32px 24px", textAlign: "center" }}>
        <p style={{ color: tokens.color.textMuted, fontSize: 12, lineHeight: 1.6, maxWidth: 480, margin: "0 auto 16px" }}>
          Sports betting carries extreme variance. This page updates from the same live data the model runs on — nothing here is cherry-picked or backfilled after the fact.
        </p>
        <a href="/" style={{ color: tokens.color.textMuted, fontSize: 12 }}>← Back to T|T</a>
      </footer>
    </div>
  );
}
