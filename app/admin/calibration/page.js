"use client";
import { useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

let _sb = null;
const getSB = () => {
  if (!_sb) _sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  return _sb;
};
const ADMIN_EMAILS = (process.env.NEXT_PUBLIC_ADMIN_EMAILS || process.env.NEXT_PUBLIC_ADMIN_EMAIL || "")
  .split(",").map(e => e.trim().toLowerCase()).filter(Boolean);

const css = `*{box-sizing:border-box;margin:0;padding:0;}body{background:#000;color:#fff;font-family:'Space Grotesk',sans-serif;}button{cursor:pointer;font-family:inherit;}a{color:#00FF87;text-decoration:none;}`;
const S = {
  page: { minHeight: "100vh", background: "#000", padding: "20px 16px", maxWidth: 680, margin: "0 auto" },
  card: { background: "#0a0a0a", border: "1px solid #1a1a1a", borderRadius: 14, padding: "14px 16px", marginBottom: 10 },
  lbl:  { fontSize: 10, fontWeight: 700, color: "#555", letterSpacing: 2, marginBottom: 8, display: "block" },
  row:  { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 },
  btn:  { border: "1px solid #333", borderRadius: 8, padding: "9px 14px", fontSize: 12, fontWeight: 700, background: "#111", color: "#fff", cursor: "pointer" },
  mono: { fontFamily: "'JetBrains Mono',monospace" },
};

function Chip({ label, value, color, sub }) {
  return (
    <div style={{ flex: 1, background: "#0a0a0a", border: "1px solid #1a1a1a", borderRadius: 12, padding: "11px 13px" }}>
      <div style={{ fontSize: 10, color: "#555", letterSpacing: 1.5, marginBottom: 5 }}>{label}</div>
      <div style={{ ...S.mono, fontSize: 18, fontWeight: 700, color: color || "#fff" }}>{value ?? "—"}</div>
      {sub && <div style={{ fontSize: 10, color: "#444", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function brierColor(v) {
  if (v == null) return "#555";
  if (v < 0.220) return "#00FF87";
  if (v < 0.240) return "#FFD600";
  return "#FF4D4D";
}

function llColor(v) {
  if (v == null) return "#555";
  if (v < 0.670) return "#00FF87";
  if (v < 0.685) return "#FFD600";
  return "#FF4D4D";
}

function deltaColor(v) {
  if (v == null) return "#555";
  if (Math.abs(v) <= 2) return "#00FF87";
  if (Math.abs(v) <= 5) return "#FFD600";
  return "#FF4D4D";
}

function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true,
    timeZone: "America/Chicago",
  }) + " CT";
}

function fmtDateShort(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" });
}

export default function CalibrationHistory() {
  const [auth, setAuth]         = useState(false);
  const [busy, setBusy]         = useState(true);
  const [token, setToken]       = useState("");
  const [snapshots, setSnaps]   = useState([]);
  const [runState, setRunState] = useState(null); // null | "loading" | "ok" | "err"
  const [runMsg, setRunMsg]     = useState("");

  useEffect(() => {
    getSB().auth.getSession().then(({ data: { session } }) => {
      const email = session?.user?.email?.toLowerCase();
      if (email && ADMIN_EMAILS.includes(email)) {
        setAuth(true);
        setToken(session.access_token);
        loadSnapshots();
      } else {
        setBusy(false);
      }
    });
  }, []);

  async function loadSnapshots() {
    setBusy(true);
    const res = await fetch("/api/calibration/snapshots?limit=60").catch(() => null);
    const d   = res?.ok ? await res.json() : null;
    setSnaps(d?.snapshots || []);
    setBusy(false);
  }

  async function runSnapshot() {
    setRunState("loading");
    setRunMsg("");
    try {
      const r = await fetch("/api/calibration/run", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const d = await r.json();
      if (d.ok) {
        setRunState("ok");
        setRunMsg(`Snapshot saved — ${d.total_picks} picks · Brier ${d.brier_score} · LL ${d.log_loss}`);
        loadSnapshots();
      } else {
        setRunState("err");
        setRunMsg(d.error || "failed");
      }
    } catch (e) {
      setRunState("err");
      setRunMsg(e.message);
    }
    setTimeout(() => { setRunState(null); setRunMsg(""); }, 10000);
  }

  const latest = snapshots[0] ?? null;
  const probBuckets = latest?.prob_buckets ?? [];
  const confBuckets = latest?.conf_buckets ?? [];

  if (busy && !auth) return (
    <div style={{ minHeight: "100vh", background: "#000", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <style>{css}</style>
      <div style={{ width: 22, height: 22, border: "2px solid #222", borderTopColor: "#00FF87", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  if (!auth) return (
    <div style={{ minHeight: "100vh", background: "#000", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <style>{css}</style>
      <div style={{ textAlign: "center" }}>
        <div style={{ ...S.mono, fontSize: 20, fontWeight: 700, marginBottom: 12 }}>T<span style={{ color: "#00FF87" }}>|</span>T</div>
        <div style={{ color: "#FF4D4D", fontSize: 13, marginBottom: 12 }}>Not authorized</div>
        <a href="/app" style={{ fontSize: 12, color: "#555" }}>← Sign in first</a>
      </div>
    </div>
  );

  return (
    <div style={S.page}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&family=JetBrains+Mono:wght@400;700&display=swap');${css}@keyframes spin{to{transform:rotate(360deg)}}`}</style>

      {/* Header */}
      <div style={{ ...S.row, marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 10, color: "#444", letterSpacing: 2 }}>ADMIN</div>
          <div style={{ ...S.mono, fontSize: 20, fontWeight: 700, marginTop: 1 }}>Calibration History</div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {busy && <div style={{ width: 14, height: 14, border: "2px solid #222", borderTopColor: "#00FF87", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />}
          <a href="/admin" style={{ fontSize: 11, color: "#444" }}>← Admin</a>
        </div>
      </div>

      {/* Latest snapshot summary */}
      {latest && (
        <>
          <span style={S.lbl}>LATEST SNAPSHOT — {fmtDate(latest.run_at)}</span>
          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            <Chip label="BRIER SCORE" value={latest.brier_score ?? "—"} color={brierColor(latest.brier_score)}
              sub="< 0.220 = excellent" />
            <Chip label="LOG LOSS"    value={latest.log_loss ?? "—"}   color={llColor(latest.log_loss)}
              sub="< 0.670 = excellent" />
            <Chip label="AVG DELTA"  value={latest.avg_delta != null ? `${latest.avg_delta > 0 ? "+" : ""}${latest.avg_delta}pp` : "—"} color={deltaColor(latest.avg_delta)}
              sub={latest.avg_delta > 2 ? "underconfident" : latest.avg_delta < -2 ? "overconfident" : "well calibrated"} />
            <Chip label="SAMPLE" value={latest.total_picks} sub="resolved bets" />
          </div>

          {/* Latest prob bucket table */}
          {probBuckets.length > 0 && (
            <>
              <span style={S.lbl}>PROBABILITY CALIBRATION (LATEST)</span>
              <div style={{ ...S.card, marginBottom: 14 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                  <thead>
                    <tr style={{ color: "#444", borderBottom: "1px solid #1a1a1a" }}>
                      {["Bucket", "Predicted", "Actual", "Delta", "CLV", "n"].map((h, i) => (
                        <th key={h} style={{ textAlign: i === 0 ? "left" : "right", paddingBottom: 8, fontWeight: 600 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {probBuckets.map(b => {
                      const delta = b.actual != null && b.predicted != null
                        ? parseFloat((b.actual - b.predicted).toFixed(1)) : null;
                      const thin  = b.n < 20;
                      return (
                        <tr key={b.label} style={{ borderBottom: "1px solid #0d0d0d" }}>
                          <td style={{ padding: "7px 0", color: thin ? "#444" : "#ccc" }}>{b.label}{thin ? " *" : ""}</td>
                          <td style={{ textAlign: "right", ...S.mono, color: "#555" }}>{b.predicted != null ? `${b.predicted}%` : "—"}</td>
                          <td style={{ textAlign: "right", ...S.mono, fontWeight: 700,
                            color: b.actual == null ? "#333" : b.actual >= 55 ? "#00FF87" : b.actual >= 50 ? "#FFD600" : "#FF4D4D" }}>
                            {b.actual != null ? `${b.actual}%` : "—"}
                          </td>
                          <td style={{ textAlign: "right", ...S.mono, fontWeight: 700, color: deltaColor(delta) }}>
                            {delta != null ? `${delta > 0 ? "+" : ""}${delta}pp` : "—"}
                          </td>
                          <td style={{ textAlign: "right", ...S.mono,
                            color: b.avgClv == null ? "#333" : b.avgClv > 0 ? "#00FF87" : "#FF4D4D" }}>
                            {b.avgClv != null ? `${b.avgClv > 0 ? "+" : ""}${b.avgClv}pp` : "—"}
                          </td>
                          <td style={{ textAlign: "right", color: thin ? "#333" : "#555" }}>{b.n}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {probBuckets.some(b => b.n < 20 && b.n > 0) && (
                  <div style={{ fontSize: 10, color: "#333", marginTop: 8 }}>* n &lt; 20 — too small to interpret</div>
                )}
              </div>
            </>
          )}

          {/* Confidence buckets */}
          {confBuckets.length > 0 && (
            <>
              <span style={S.lbl}>CONFIDENCE CALIBRATION (LATEST)</span>
              <div style={{ ...S.card, marginBottom: 14 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                  <thead>
                    <tr style={{ color: "#444", borderBottom: "1px solid #1a1a1a" }}>
                      {["Confidence", "W-L", "Win%", "Avg CLV", "n"].map((h, i) => (
                        <th key={h} style={{ textAlign: i === 0 ? "left" : "right", paddingBottom: 8, fontWeight: 600 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {confBuckets.map(b => (
                      <tr key={b.label} style={{ borderBottom: "1px solid #0d0d0d" }}>
                        <td style={{ padding: "7px 0", color: "#ccc" }}>{b.label}</td>
                        <td style={{ textAlign: "right", ...S.mono, color: "#888" }}>{b.n > 0 ? `${b.wins}-${b.n - b.wins}` : "—"}</td>
                        <td style={{ textAlign: "right", ...S.mono, fontWeight: 700,
                          color: b.actual == null ? "#333" : b.actual >= 55 ? "#00FF87" : b.actual >= 50 ? "#FFD600" : "#FF4D4D" }}>
                          {b.actual != null ? `${b.actual}%` : "—"}
                        </td>
                        <td style={{ textAlign: "right", ...S.mono,
                          color: b.avgClv == null ? "#333" : b.avgClv > 0 ? "#00FF87" : "#FF4D4D" }}>
                          {b.avgClv != null ? `${b.avgClv > 0 ? "+" : ""}${b.avgClv}pp` : "—"}
                        </td>
                        <td style={{ textAlign: "right", color: "#555" }}>{b.n || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}

      {/* Historical trend */}
      <span style={S.lbl}>SNAPSHOT HISTORY ({snapshots.length})</span>
      {snapshots.length === 0 && !busy && (
        <div style={{ ...S.card, color: "#555", fontSize: 13 }}>
          No snapshots yet. Run one manually below, or wait for the nightly Lambda at 3:30 AM CT.
        </div>
      )}
      {snapshots.length > 0 && (
        <div style={{ ...S.card, marginBottom: 14, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, minWidth: 400 }}>
            <thead>
              <tr style={{ color: "#444", borderBottom: "1px solid #1a1a1a" }}>
                {["Date", "Picks", "Brier", "Log Loss", "Bias"].map((h, i) => (
                  <th key={h} style={{ textAlign: i === 0 ? "left" : "right", paddingBottom: 8, fontWeight: 600, whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {snapshots.map((s, idx) => {
                const isLatest = idx === 0;
                return (
                  <tr key={s.id} style={{ borderBottom: "1px solid #0a0a0a" }}>
                    <td style={{ padding: "6px 0", color: isLatest ? "#fff" : "#666", whiteSpace: "nowrap", fontWeight: isLatest ? 700 : 400 }}>
                      {fmtDateShort(s.run_at)}{isLatest ? " ★" : ""}
                    </td>
                    <td style={{ textAlign: "right", color: "#555", ...S.mono }}>{s.total_picks}</td>
                    <td style={{ textAlign: "right", ...S.mono, color: brierColor(s.brier_score), fontWeight: 700 }}>
                      {s.brier_score ?? "—"}
                    </td>
                    <td style={{ textAlign: "right", ...S.mono, color: llColor(s.log_loss) }}>
                      {s.log_loss ?? "—"}
                    </td>
                    <td style={{ textAlign: "right", ...S.mono, color: deltaColor(s.avg_delta) }}>
                      {s.avg_delta != null ? `${s.avg_delta > 0 ? "+" : ""}${s.avg_delta}pp` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Reference card */}
      <span style={S.lbl}>METRIC REFERENCE</span>
      <div style={{ ...S.card, marginBottom: 14 }}>
        {[
          ["Brier score",  "< 0.220 excellent · 0.220–0.240 good · > 0.25 = coin flip (0.25)"],
          ["Log loss",     "< 0.670 excellent · 0.670–0.685 good · > 0.693 = coin flip ln(2)"],
          ["Avg delta",    "actual − predicted in pp. Negative = overconfident, positive = underconfident"],
          ["Green delta",  "±2pp or better. Yellow ±5pp. Red beyond ±5pp."],
        ].map(([k, v]) => (
          <div key={k} style={{ ...S.row, padding: "8px 0", borderBottom: "1px solid #0a0a0a" }}>
            <span style={{ fontSize: 11, color: "#555", flexShrink: 0, minWidth: 90 }}>{k}</span>
            <span style={{ fontSize: 11, color: "#444", textAlign: "right" }}>{v}</span>
          </div>
        ))}
      </div>

      {/* Run now */}
      <span style={S.lbl}>MANUAL RUN</span>
      <div style={S.card}>
        <div style={{ fontSize: 12, color: "#555", marginBottom: 10, lineHeight: 1.6 }}>
          Computes a fresh snapshot from current model_picks data and saves it to calibration_snapshots.
          The nightly Lambda does this automatically at 3:30 AM CT after resolve runs at 3:00 AM CT.
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button
            onClick={runSnapshot}
            disabled={runState === "loading"}
            style={{
              ...S.btn,
              background: runState === "ok" ? "rgba(0,255,135,0.08)" : runState === "err" ? "rgba(255,77,77,0.08)" : "#111",
              color:      runState === "ok" ? "#00FF87" : runState === "err" ? "#FF4D4D" : "#fff",
              border:     `1px solid ${runState === "ok" ? "rgba(0,255,135,0.3)" : runState === "err" ? "rgba(255,77,77,0.3)" : "#333"}`,
            }}>
            {runState === "loading" ? "Running…" : runState === "ok" ? "✓ Saved" : runState === "err" ? "✗ Failed" : "⚡ Run Snapshot Now"}
          </button>
          {runMsg && <span style={{ fontSize: 11, color: runState === "ok" ? "#00FF87" : "#FF4D4D" }}>{runMsg}</span>}
        </div>
      </div>

      {/* AWS pipeline info */}
      <span style={{ ...S.lbl, marginTop: 18, display: "block" }}>AWS PIPELINE</span>
      <div style={S.card}>
        {[
          ["Lambda",       "tot-calibration-snapshot (Python 3.12, 60s timeout)"],
          ["Trigger",      "EventBridge cron — cron(30 8 * * ? *) = 3:30 AM CT"],
          ["Alarm",        "CloudWatch: tot-calibration-lambda-errors (any error → alert)"],
          ["IaC",          "infra/terraform/ — terraform apply to deploy"],
          ["DB",           "calibration_snapshots table (Supabase Postgres)"],
        ].map(([k, v]) => (
          <div key={k} style={{ ...S.row, padding: "8px 0", borderBottom: "1px solid #0a0a0a" }}>
            <span style={{ fontSize: 11, color: "#555", flexShrink: 0, minWidth: 80 }}>{k}</span>
            <span style={{ ...S.mono, fontSize: 11, color: "#444", textAlign: "right" }}>{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
