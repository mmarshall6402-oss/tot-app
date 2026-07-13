// app/admin/backtest/page.js
// Internal backtesting & calibration dashboard — historical replay of the
// production probability model / filter engine against 2022-2024 games.
// Protected: only accessible if logged in as admin email.

"use client";
import { useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";
import CalibrationChart from "../../../components/backtest/CalibrationChart.js";

const ADMIN_EMAILS = (process.env.NEXT_PUBLIC_ADMIN_EMAILS || process.env.NEXT_PUBLIC_ADMIN_EMAIL || "")
  .split(",").map(e => e.trim().toLowerCase()).filter(Boolean);

const TIER_LABEL = { elo_only: "Elo + Park (Tier 1)", full_replay: "Full 7-Factor Replay (Tier 2)", roi_real_odds: "ROI / Real Odds (Tier 3)" };

function fmtDate(d) {
  if (!d) return "—";
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
}

function StatCard({ label, value, color, sub }) {
  return (
    <div style={S.statCard}>
      <div style={{ ...S.statVal, color: color || "#fff" }}>{value ?? "—"}</div>
      <div style={S.statLabel}>{label}</div>
      {sub && <div style={S.statSub}>{sub}</div>}
    </div>
  );
}

export default function AdminBacktest() {
  const [authorized, setAuthorized] = useState(false);
  const [run, setRun] = useState(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [tab, setTab] = useState("overview");
  const [error, setError] = useState("");

  const getToken = async () => {
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token || "";
  };

  const fetchLatest = async () => {
    setLoading(true);
    setError("");
    try {
      const token = await getToken();
      const res = await fetch("/api/admin/backtest", { headers: { Authorization: `Bearer ${token}` } });
      const d = await res.json();
      if (d.error) setError(d.error);
      setRun(d.run || null);
    } catch (e) {
      setError("Failed to load");
    }
    setLoading(false);
  };

  useEffect(() => {
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    supabase.auth.getSession().then(({ data: { session } }) => {
      const u = session?.user;
      if (u?.email && ADMIN_EMAILS.includes(u.email.toLowerCase())) setAuthorized(true);
      else setLoading(false);
    });
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch-on-auth pattern, mirrors app/admin/tracker/page.js
    if (authorized) fetchLatest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authorized]);

  const runBacktest = async () => {
    setRunning(true);
    setError("");
    try {
      const token = await getToken();
      const res = await fetch("/api/admin/backtest", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ tier: 1 }),
      });
      const d = await res.json();
      if (d.error) setError(d.error);
      else setRun(d.run);
    } catch (e) {
      setError("Run failed");
    }
    setRunning(false);
  };

  if (!authorized && !loading) return (
    <div style={{ minHeight: "100vh", background: "#000", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ color: "#444", fontSize: 14 }}>Unauthorized</div>
    </div>
  );

  const m = run?.metrics;
  const fmtBrier = v => v != null ? v.toFixed(4) : "—";
  const brierColor = (v, baseline) => v == null ? "#555" : v < baseline ? "#00FF87" : "#FF4D4D";

  return (
    <div style={S.page}>
      <style>{css}</style>
      <div style={S.header}>
        <div style={S.logo}>T<span style={{ color: "#00FF87" }}>|</span>T <span style={{ color: "#444", fontSize: 13, fontWeight: 400 }}>Backtest Engine</span></div>
        <a href="/admin" style={{ fontSize: 11, color: "#444" }}>← Admin</a>
      </div>

      {loading ? (
        <div style={S.center}><div style={S.spinner} /></div>
      ) : (<>
        {!run && (
          <div style={{ color: "#555", fontSize: 13, marginBottom: 16 }}>
            No backtest runs yet. Run one from the local script (<code style={{ color: "#00FF87" }}>npm run backtest -- --tier=1</code>) or trigger below.
          </div>
        )}
        {error && <div style={{ color: "#FF4D4D", fontSize: 12, marginBottom: 12 }}>{error}</div>}

        {run && (
          <div style={{ fontSize: 11, color: "#444", marginBottom: 16 }}>
            {TIER_LABEL[run.tier] || run.tier} · {fmtDate(run.season_start)} → {fmtDate(run.season_end)} · {run.game_count} games · run {new Date(run.run_at).toLocaleString()}
          </div>
        )}

        {/* Tabs */}
        <div style={S.tabs}>
          {["overview", "calibration"].map(t => (
            <button key={t} style={{ ...S.tabBtn, color: tab === t ? "#00FF87" : "#444", borderColor: tab === t ? "#00FF87" : "transparent" }} onClick={() => setTab(t)}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
          <button key="run" style={{ ...S.tabBtn, color: tab === "run" ? "#00FF87" : "#444", borderColor: tab === "run" ? "#00FF87" : "transparent" }} onClick={() => setTab("run")}>
            Run Backtest
          </button>
        </div>

        {tab === "overview" && m && (
          <div>
            <div style={S.sectionLabel}>PROBABILITY CALIBRATION SUMMARY (BRIER SCORE — LOWER IS BETTER)</div>
            <div style={S.grid4}>
              <StatCard label="Always 50%" value={fmtBrier(m.baselines.always50.brier)} sub="baseline" />
              <StatCard label="Raw Elo" value={fmtBrier(m.baselines.rawElo.brier)} color={brierColor(m.baselines.rawElo.brier, m.baselines.always50.brier)} />
              <StatCard label="Production Model" value={fmtBrier(m.model.brier)} color={brierColor(m.model.brier, m.baselines.always50.brier)} />
              <StatCard label="+ Isotonic Recal." value={fmtBrier(m.modelIsotonicRecalibrated.brier)} color={brierColor(m.modelIsotonicRecalibrated.brier, m.model.brier)} sub={m.modelIsotonicRecalibrated.brier < m.model.brier ? "improved" : "no improvement"} />
            </div>
            <div style={{ ...S.sectionLabel, marginTop: 20 }}>LOG LOSS</div>
            <div style={S.grid4}>
              <StatCard label="Always 50%" value={m.baselines.always50.logLoss?.toFixed(4)} sub="baseline" />
              <StatCard label="Raw Elo" value={m.baselines.rawElo.logLoss?.toFixed(4)} />
              <StatCard label="Production Model" value={m.model.logLoss?.toFixed(4)} />
              <StatCard label="+ Isotonic Recal." value={m.modelIsotonicRecalibrated.logLoss?.toFixed(4)} />
            </div>
            <div style={{ fontSize: 11, color: "#333", marginTop: 16, lineHeight: 1.6 }}>
              Brier score: mean squared error between predicted probability and actual outcome (0 = perfect, 0.25 = &quot;always guess 50%&quot;).
              This tier replays the production model&apos;s Elo+park fallback path (no live stat feed) against walk-forward-reconstructed
              Elo ratings, so no game&apos;s own outcome ever leaks into its own prediction.
            </div>
          </div>
        )}

        {tab === "calibration" && m && (
          <div>
            <div style={S.sectionLabel}>RELIABILITY DIAGRAM</div>
            <div style={{ fontSize: 11, color: "#444", marginBottom: 14, lineHeight: 1.6 }}>
              Does a 60% predicted probability actually win 60% of the time? Points on the dashed line = perfectly calibrated.
            </div>
            <CalibrationChart series={[
              { name: "Production model (Elo+park)", color: "#00FF87", buckets: m.model.calibration },
              { name: "Isotonic-recalibrated", color: "#FFD600", buckets: m.modelIsotonicRecalibrated.calibration },
            ]} />
          </div>
        )}

        {tab === "run" && (
          <div>
            <div style={S.sectionLabel}>RUN A NEW BACKTEST</div>
            <div style={{ fontSize: 12, color: "#444", marginBottom: 16, lineHeight: 1.6 }}>
              Tier 1 (Elo + park, no stat feed) runs in-process against all 7,289 historical games and completes in seconds.
            </div>
            <button style={S.runBtn} onClick={runBacktest} disabled={running}>
              {running ? "Running…" : "Run Tier 1 Backtest"}
            </button>
          </div>
        )}
      </>)}
    </div>
  );
}

const css = `
  @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;700&display=swap');
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
  html,body{background:#000;color:#fff;font-family:'Space Grotesk',sans-serif;}
  button{cursor:pointer;border:none;font-family:inherit;}
  @keyframes spin{to{transform:rotate(360deg);}}
`;

const S = {
  page:       { minHeight: "100vh", background: "#000", padding: "20px 20px 60px" },
  header:     { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, paddingBottom: 16, borderBottom: "1px solid #111" },
  logo:       { fontFamily: "'JetBrains Mono',monospace", fontSize: 18, fontWeight: 700 },
  grid4:      { display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8, marginBottom: 8 },
  statCard:   { background: "#080808", border: "1px solid #1a1a1a", borderRadius: 10, padding: "12px 10px", textAlign: "center" },
  statVal:    { fontSize: 18, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", marginBottom: 4 },
  statLabel:  { fontSize: 10, color: "#333", letterSpacing: 0.5 },
  statSub:    { fontSize: 9, color: "#333", marginTop: 2 },
  tabs:       { display: "flex", gap: 4, marginBottom: 16, borderBottom: "1px solid #111", paddingBottom: 8 },
  tabBtn:     { padding: "4px 12px", borderRadius: 6, fontSize: 12, fontWeight: 600, background: "transparent", border: "1px solid transparent" },
  sectionLabel: { fontSize: 10, fontWeight: 700, color: "#333", letterSpacing: 1.5, marginBottom: 10 },
  runBtn:     { padding: "10px 20px", borderRadius: 8, background: "#00FF87", border: "none", color: "#000", fontSize: 13, fontWeight: 700 },
  center:     { display: "flex", justifyContent: "center", padding: 60 },
  spinner:    { width: 24, height: 24, border: "2px solid #1a1a1a", borderTopColor: "#00FF87", borderRadius: "50%", animation: "spin 0.7s linear infinite" },
};
