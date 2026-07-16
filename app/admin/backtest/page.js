// app/admin/backtest/page.js
// Internal backtesting & calibration dashboard — historical replay of the
// production probability model / filter engine against 2022-2025 games.
// Protected: only accessible if logged in as admin email.

"use client";
import { useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";
import CalibrationChart from "../../../components/backtest/CalibrationChart.js";
import EdgeHistogram from "../../../components/backtest/EdgeHistogram.js";
import EquityCurve from "../../../components/backtest/EquityCurve.js";

const ADMIN_EMAILS = (process.env.NEXT_PUBLIC_ADMIN_EMAILS || process.env.NEXT_PUBLIC_ADMIN_EMAIL || "")
  .split(",").map(e => e.trim().toLowerCase()).filter(Boolean);

const TIERS = ["elo_only", "full_replay", "roi_real_odds"];
const TIER_LABEL = { elo_only: "Elo + Park (Tier 1)", full_replay: "Full 7-Factor Replay (Tier 2)", roi_real_odds: "ROI / Real Odds (Tier 3)" };
const TIER_NUM = { elo_only: 1, full_replay: 2, roi_real_odds: 3 };

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

const fmtBrier = v => v != null ? v.toFixed(4) : "—";
const brierColor = (v, baseline) => v == null ? "#555" : v < baseline ? "#00FF87" : "#FF4D4D";

function Tier1Overview({ m }) {
  return (
    <div>
      <div style={S.sectionLabel}>PROBABILITY CALIBRATION SUMMARY (BRIER SCORE — LOWER IS BETTER)</div>
      <div style={S.grid4}>
        <StatCard label="Always 50%" value={fmtBrier(m.baselines.always50.brier)} sub="baseline" />
        <StatCard label="Raw Elo" value={fmtBrier(m.baselines.rawElo.brier)} color={brierColor(m.baselines.rawElo.brier, m.baselines.always50.brier)} />
        <StatCard label="Production Model" value={fmtBrier(m.model.brier)} color={brierColor(m.model.brier, m.baselines.always50.brier)} />
        <StatCard label="+ Isotonic Recal." value={fmtBrier(m.modelIsotonicRecalibrated.brier)} color={brierColor(m.modelIsotonicRecalibrated.brier, m.model.brier)} sub={m.modelIsotonicRecalibrated.brier < m.model.brier ? "improved" : "no improvement"} />
      </div>
      <div style={{ fontSize: 11, color: "#333", marginTop: 16, lineHeight: 1.6 }}>
        Replays the production model&apos;s Elo+park fallback path (no live stat feed) against walk-forward-reconstructed
        Elo ratings, so no game&apos;s own outcome ever leaks into its own prediction.
      </div>
    </div>
  );
}

function Tier2Overview({ m }) {
  return (
    <div>
      <div style={S.sectionLabel}>HELD-OUT SEASON BRIER SCORE (BEFORE / AFTER ISOTONIC RECALIBRATION)</div>
      <div style={{ fontSize: 11, color: "#444", marginBottom: 10 }}>Isotonic fit on 2022+2023 only ({m.trainCount} games) — never touches 2024/2025.</div>
      <div style={S.grid4}>
        <StatCard label="2024 holdout (before)" value={fmtBrier(m.holdout2024.beforeCalibration.brier)} sub={`n=${m.eval2024Count}`} />
        <StatCard label="2024 holdout (after)" value={fmtBrier(m.holdout2024.afterIsotonicCalibration.brier)} color={brierColor(m.holdout2024.afterIsotonicCalibration.brier, m.holdout2024.beforeCalibration.brier)} />
        {m.holdout2025 && <StatCard label="2025 holdout (before)" value={fmtBrier(m.holdout2025.beforeCalibration.brier)} sub={`n=${m.eval2025Count} · true out-of-corpus`} />}
        {m.holdout2025 && <StatCard label="2025 holdout (after)" value={fmtBrier(m.holdout2025.afterIsotonicCalibration.brier)} color={brierColor(m.holdout2025.afterIsotonicCalibration.brier, m.holdout2025.beforeCalibration.brier)} />}
      </div>
      <div style={{ fontSize: 11, color: "#333", marginTop: 16, lineHeight: 1.6 }}>
        2025 wasn&apos;t part of the original archive this backtest was built against — it was added afterward, making it a stronger
        holdout than 2024. Both showing the same before/after direction is evidence the finding isn&apos;t a fluke of one season.
      </div>
    </div>
  );
}

function Tier3Overview({ m }) {
  return (
    <div>
      <div style={S.sectionLabel}>2025 REAL-ODDS BACKTEST (STARTING BANKROLL $1,000)</div>
      <div style={S.grid4}>
        <StatCard label="Bets Placed" value={m.betsPlaced} sub={`of ${m.gameCount} games`} />
        <StatCard label="Record" value={`${m.wins}-${m.losses}`} color={m.winPct >= 55 ? "#00FF87" : m.winPct >= 50 ? "#FFD600" : "#FF4D4D"} sub={m.winPct != null ? `${m.winPct.toFixed(1)}%` : "—"} />
        <StatCard label="ROI" value={m.roiPct != null ? `${m.roiPct > 0 ? "+" : ""}${m.roiPct.toFixed(1)}%` : "—"} color={m.roiPct > 0 ? "#00FF87" : "#FF4D4D"} />
        <StatCard label="Max Drawdown" value={`${m.maxDrawdownPct}%`} color="#FFD600" />
      </div>
      <div style={{ background: "#1a1200", border: "1px solid #FFD600", borderRadius: 10, padding: "10px 14px", marginTop: 14, fontSize: 11, color: "#FFD600", lineHeight: 1.6 }}>
        Real market odds (consensus, shanemcd.org), full 2025 regular season. {m.excludedNoOddsMatch} game{m.excludedNoOddsMatch === 1 ? "" : "s"} excluded
        (no matched odds row — not backfilled). {m.betsPlaced} bets is a small sample — the live tracker&apos;s own rule of thumb is
        100+ for significance. This validates the filter/Kelly pipeline end-to-end against real outcomes; it is not a claim of
        durable long-run profitability.
      </div>
    </div>
  );
}

export default function AdminBacktest() {
  const [authorized, setAuthorized] = useState(false);
  const [runsByTier, setRunsByTier] = useState({});
  const [viewTier, setViewTier] = useState(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [runTierChoice, setRunTierChoice] = useState(1);
  const [tab, setTab] = useState("overview");
  const [error, setError] = useState("");

  const getToken = async () => {
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token || "";
  };

  const fetchAll = async () => {
    setLoading(true);
    setError("");
    try {
      const token = await getToken();
      const results = await Promise.all(TIERS.map(t =>
        fetch(`/api/admin/backtest?tier=${t}`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json())
      ));
      const next = {};
      TIERS.forEach((t, i) => { next[t] = results[i]; });
      setRunsByTier(next);
      const firstAvailable = [...TIERS].reverse().find(t => next[t]?.run);
      setViewTier(prev => prev ?? firstAvailable ?? "elo_only");
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
    if (authorized) fetchAll();
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
        body: JSON.stringify({ tier: runTierChoice }),
      });
      const d = await res.json();
      if (d.error) setError(d.error);
      else await fetchAll();
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

  const current = viewTier ? runsByTier[viewTier] : null;
  const run = current?.run;
  const games = current?.games || [];
  const m = run?.metrics;
  const isTier3 = run?.tier === "roi_real_odds";
  const isCalibrationTier = run?.tier === "elo_only" || run?.tier === "full_replay";

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
        {error && <div style={{ color: "#FF4D4D", fontSize: 12, marginBottom: 12 }}>{error}</div>}

        {/* Tier picker */}
        <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
          {TIERS.map(t => (
            <button key={t} onClick={() => setViewTier(t)}
              style={{ ...S.pill, background: viewTier === t ? "#00FF87" : "transparent", color: viewTier === t ? "#000" : runsByTier[t]?.run ? "#888" : "#333", border: `1px solid ${viewTier === t ? "#00FF87" : "#1a1a1a"}` }}>
              Tier {TIER_NUM[t]}{!runsByTier[t]?.run ? " (none)" : ""}
            </button>
          ))}
        </div>

        {!run && (
          <div style={{ color: "#555", fontSize: 13, marginBottom: 16 }}>
            No {TIER_LABEL[viewTier]} runs yet. Run one from the local script
            (<code style={{ color: "#00FF87" }}>npm run backtest -- --tier={TIER_NUM[viewTier]}</code>) or trigger below.
          </div>
        )}

        {run && (
          <div style={{ fontSize: 11, color: "#444", marginBottom: 16 }}>
            {TIER_LABEL[run.tier] || run.tier} · {fmtDate(run.season_start)} → {fmtDate(run.season_end)} · {run.game_count} games · run {new Date(run.run_at).toLocaleString()}
          </div>
        )}

        {/* Tabs */}
        <div style={S.tabs}>
          <button style={{ ...S.tabBtn, color: tab === "overview" ? "#00FF87" : "#444", borderColor: tab === "overview" ? "#00FF87" : "transparent" }} onClick={() => setTab("overview")}>Overview</button>
          {isCalibrationTier && (
            <button style={{ ...S.tabBtn, color: tab === "calibration" ? "#00FF87" : "#444", borderColor: tab === "calibration" ? "#00FF87" : "transparent" }} onClick={() => setTab("calibration")}>Calibration</button>
          )}
          {isTier3 && (
            <button style={{ ...S.tabBtn, color: tab === "verdict" ? "#00FF87" : "#444", borderColor: tab === "verdict" ? "#00FF87" : "transparent" }} onClick={() => setTab("verdict")}>Verdict &amp; ROI</button>
          )}
          <button style={{ ...S.tabBtn, color: tab === "run" ? "#00FF87" : "#444", borderColor: tab === "run" ? "#00FF87" : "transparent" }} onClick={() => setTab("run")}>Run Backtest</button>
        </div>

        {tab === "overview" && m && run.tier === "elo_only" && <Tier1Overview m={m} />}
        {tab === "overview" && m && run.tier === "full_replay" && <Tier2Overview m={m} />}
        {tab === "overview" && m && run.tier === "roi_real_odds" && <Tier3Overview m={m} />}

        {tab === "calibration" && m && run.tier === "elo_only" && (
          <div>
            <div style={S.sectionLabel}>RELIABILITY DIAGRAM</div>
            <CalibrationChart series={[
              { name: "Production model (Elo+park)", color: "#00FF87", buckets: m.model.calibration },
              { name: "Isotonic-recalibrated", color: "#FFD600", buckets: m.modelIsotonicRecalibrated.calibration },
            ]} />
          </div>
        )}
        {tab === "calibration" && m && run.tier === "full_replay" && (
          <div>
            <div style={S.sectionLabel}>RELIABILITY DIAGRAM — 2024 HOLDOUT</div>
            <CalibrationChart series={[
              { name: "2024 holdout (before)", color: "#00FF87", buckets: m.holdout2024.beforeCalibration.calibration },
              { name: "2024 holdout (after isotonic)", color: "#FFD600", buckets: m.holdout2024.afterIsotonicCalibration.calibration },
            ]} />
            {m.holdout2025 && (<>
              <div style={{ ...S.sectionLabel, marginTop: 24 }}>RELIABILITY DIAGRAM — 2025 TRUE OUT-OF-CORPUS HOLDOUT</div>
              <CalibrationChart series={[
                { name: "2025 holdout (before)", color: "#00FF87", buckets: m.holdout2025.beforeCalibration.calibration },
                { name: "2025 holdout (after isotonic)", color: "#FFD600", buckets: m.holdout2025.afterIsotonicCalibration.calibration },
              ]} />
            </>)}
          </div>
        )}

        {tab === "verdict" && isTier3 && m && (
          <div>
            <div style={S.sectionLabel}>VERDICT BREAKDOWN</div>
            <div style={S.grid4}>
              {m.verdictBreakdown.map(v => (
                <StatCard key={v.verdict} label={v.verdict} value={v.n}
                  color={v.verdict === "CLEAN" ? "#00FF87" : v.verdict === "BET" ? "#3ddc84" : v.verdict === "TRAP" ? "#FF4D4D" : "#666"}
                  sub={v.settled > 0 ? `${v.wins}-${v.settled - v.wins} (${v.winPct.toFixed(0)}%)` : "not bet"} />
              ))}
            </div>

            <div style={{ ...S.sectionLabel, marginTop: 24 }}>EQUITY CURVE</div>
            <EquityCurve
              points={games.filter(g => g.bet_result === "win" || g.bet_result === "loss").map(g => ({ date: g.date, bankroll: g.bankroll_after }))}
              startingBankroll={run.params?.startingBankroll || 1000}
            />

            <div style={{ ...S.sectionLabel, marginTop: 24 }}>EDGE DISTRIBUTION</div>
            <EdgeHistogram rows={games} />
          </div>
        )}

        {tab === "run" && (
          <div>
            <div style={S.sectionLabel}>RUN A NEW BACKTEST</div>
            <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
              {[1, 2, 3].map(t => (
                <button key={t} onClick={() => setRunTierChoice(t)}
                  style={{ ...S.pill, background: runTierChoice === t ? "#00FF87" : "transparent", color: runTierChoice === t ? "#000" : "#888", border: `1px solid ${runTierChoice === t ? "#00FF87" : "#1a1a1a"}` }}>
                  Tier {t}
                </button>
              ))}
            </div>
            <div style={{ fontSize: 12, color: "#444", marginBottom: 16, lineHeight: 1.6 }}>
              {runTierChoice === 1 && "Elo + park, no stat feed — runs against all historical games, completes in seconds."}
              {runTierChoice === 2 && "Full 7-factor replay with walk-forward season stats, isotonic recalibration on a 2022-2023 train / 2024+2025 holdout split."}
              {runTierChoice === 3 && "ROI/Kelly backtest against real 2025 market odds — the only season with real historical odds in this repo."}
            </div>
            <button style={S.runBtn} onClick={runBacktest} disabled={running}>
              {running ? "Running…" : `Run Tier ${runTierChoice} Backtest`}
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
  pill:       { padding: "4px 12px", borderRadius: 20, fontSize: 12, fontWeight: 700 },
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
