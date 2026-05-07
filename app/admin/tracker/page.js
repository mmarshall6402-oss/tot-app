// app/admin/tracker/page.js
// Internal model performance dashboard
// Protected: only accessible if logged in as admin email

"use client";
export const dynamic = 'force-dynamic';
import { useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

const ADMIN_KEY = process.env.NEXT_PUBLIC_ADMIN_KEY || "";
const ADMIN_EMAIL = process.env.NEXT_PUBLIC_ADMIN_EMAIL || "";

const fmtPct = (v) => v != null ? `${v}%` : "—";
const fmtROI = (v) => v != null ? `${v > 0 ? "+" : ""}${v}u` : "—";

function StatCard({ label, value, color }) {
  return (
    <div style={S.statCard}>
      <div style={{ ...S.statVal, color: color || "#fff" }}>{value ?? "—"}</div>
      <div style={S.statLabel}>{label}</div>
    </div>
  );
}

export default function AdminTracker() {
  const [user, setUser] = useState(null);
  const [authorized, setAuthorized] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState(false);
  const [days, setDays] = useState(30);
  const [tab, setTab] = useState("overview");
  const [resolveMsg, setResolveMsg] = useState("");

  useEffect(() => {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    );
    supabase.auth.getSession().then(({ data: { session } }) => {
      const u = session?.user;
      setUser(u);
      if (u?.email === ADMIN_EMAIL || ADMIN_EMAIL === "") setAuthorized(true);
    });
  }, []);

  useEffect(() => {
    if (!authorized) return;
    fetchStats();
  }, [authorized, days]);

  const fetchStats = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/tracker?action=stats&days=${days}`, {
        headers: { "x-admin-key": ADMIN_KEY },
      });
      const d = await res.json();
      setData(d);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  const resolveDate = async (date) => {
    setResolving(true);
    setResolveMsg("");
    try {
      const res = await fetch("/api/admin/tracker", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-key": ADMIN_KEY },
        body: JSON.stringify({ action: "resolve", date }),
      });
      const d = await res.json();
      setResolveMsg(`Resolved ${d.resolved ?? 0}/${d.total ?? 0} picks for ${date}`);
      fetchStats();
    } catch (e) {
      setResolveMsg("Error resolving");
    }
    setResolving(false);
  };

  if (!authorized) return (
    <div style={{ minHeight: "100vh", background: "#000", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ color: "#444", fontSize: 14 }}>Unauthorized</div>
    </div>
  );

  const o = data?.overall;

  return (
    <div style={S.page}>
      <style>{css}</style>
      <div style={S.header}>
        <div style={S.logo}>T<span style={{ color: "#00FF87" }}>|</span>T <span style={{ color: "#444", fontSize: 13, fontWeight: 400 }}>Model Tracker</span></div>
        <div style={{ display: "flex", gap: 6 }}>
          {[7, 30, 90].map(d => (
            <button key={d} style={{ ...S.pill, background: days === d ? "#00FF87" : "transparent", color: days === d ? "#000" : "#444" }} onClick={() => setDays(d)}>
              {d}d
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div style={S.center}><div style={S.spinner} /></div>
      ) : (<>
        {/* Overall stats */}
        <div style={S.grid4}>
          <StatCard label="Record" value={o ? `${o.wins}-${o.losses}` : "—"} color="#fff" />
          <StatCard label="Win %" value={fmtPct(o?.winPct)} color={o?.winPct >= 55 ? "#00FF87" : o?.winPct >= 50 ? "#FFD600" : "#FF4D4D"} />
          <StatCard label="ROI / Bet" value={fmtROI(o?.roi)} color={o?.roi > 0 ? "#00FF87" : "#FF4D4D"} />
          <StatCard label="Avg Edge" value={o?.avgEdge ? `${o.avgEdge}%` : "—"} />
        </div>
        <div style={S.grid3}>
          <StatCard label="BETs Placed" value={o?.bets} />
          <StatCard label="Pending" value={o?.pending} color="#FFD600" />
          <StatCard label="Settled" value={o ? o.wins + o.losses : "—"} />
        </div>

        {/* Tabs */}
        <div style={S.tabs}>
          {["overview", "by tier", "picks", "resolve"].map(t => (
            <button key={t} style={{ ...S.tabBtn, color: tab === t ? "#00FF87" : "#444", borderColor: tab === t ? "#00FF87" : "transparent" }} onClick={() => setTab(t)}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {tab === "overview" && (
          <div>
            <div style={S.sectionLabel}>DAILY RECORD (last {days}d)</div>
            {(data?.daily || []).slice(0, 14).map(d => (
              <div key={d.date} style={S.row}>
                <span style={S.rowDate}>{d.date}</span>
                <span style={S.rowRecord}>{d.wins ?? 0}-{d.losses ?? 0}</span>
                <span style={{ ...S.rowPct, color: d.win_pct >= 55 ? "#00FF87" : d.win_pct >= 50 ? "#FFD600" : "#FF4D4D" }}>
                  {d.win_pct != null ? `${d.win_pct}%` : "—"}
                </span>
                <span style={{ color: "#333", fontSize: 11, fontFamily: "'JetBrains Mono',monospace" }}>
                  {d.roi_per_bet != null ? `${d.roi_per_bet > 0 ? "+" : ""}${d.roi_per_bet}u` : ""}
                </span>
                <span style={{ color: "#555", fontSize: 11, marginLeft: "auto" }}>{d.pending > 0 ? `${d.pending} pending` : ""}</span>
              </div>
            ))}
          </div>
        )}

        {tab === "by tier" && (
          <div>
            <div style={S.sectionLabel}>PERFORMANCE BY TIER</div>
            {(data?.byTier || []).map(t => (
              <div key={t.tier} style={S.row}>
                <span style={{ ...S.tierBadge, color: t.tier === "High" ? "#00FF87" : t.tier === "Medium" ? "#FFD600" : "#888" }}>
                  {t.tier === "High" ? "🔥" : t.tier === "Medium" ? "✅" : "👀"} {t.tier}
                </span>
                <span style={S.rowRecord}>{t.wins ?? 0}-{t.losses ?? 0}</span>
                <span style={{ ...S.rowPct, color: t.win_pct >= 55 ? "#00FF87" : t.win_pct >= 50 ? "#FFD600" : "#FF4D4D" }}>
                  {t.win_pct != null ? `${t.win_pct}%` : "—"}
                </span>
                <span style={{ color: "#444", fontSize: 11 }}>{t.bets} bets · avg {t.avg_edge}% edge</span>
                {t.avg_clv != null && (
                  <span style={{ color: t.avg_clv > 0 ? "#00FF87" : "#FF4D4D", fontSize: 11, marginLeft: "auto" }}>
                    CLV {t.avg_clv > 0 ? "+" : ""}{t.avg_clv}%
                  </span>
                )}
              </div>
            ))}
            <div style={{ ...S.sectionLabel, marginTop: 20, marginBottom: 8 }}>HOW TO READ</div>
            <div style={{ fontSize: 12, color: "#444", lineHeight: 1.7 }}>
              <strong style={{ color: "#555" }}>Win %:</strong> High tier &gt; 58% → model is sharp at top picks. All tiers ≈ 50% → model is noise.<br />
              <strong style={{ color: "#555" }}>CLV:</strong> Positive = model picked before market moved same way = genuinely sharp. This matters more than win rate long-term.<br />
              <strong style={{ color: "#555" }}>Sample:</strong> Need ~100+ settled bets per tier for statistical significance.
            </div>
          </div>
        )}

        {tab === "picks" && (
          <div>
            <div style={S.sectionLabel}>RECENT MODEL PICKS</div>
            {(data?.recent || []).filter(p => p.is_bet).map(p => (
              <div key={p.id} style={{ ...S.pickRow, borderColor: p.result === "win" ? "rgba(0,255,135,0.2)" : p.result === "loss" ? "rgba(255,77,77,0.15)" : "#1a1a1a" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, color: "#555", marginBottom: 2 }}>{p.date} · {p.tier}</div>
                  <div style={{ fontSize: 13, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace" }}>
                    {p.away_team} @ {p.home_team}
                  </div>
                  <div style={{ fontSize: 12, color: "#555", marginTop: 2 }}>
                    Take <span style={{ color: "#fff" }}>{p.pick}</span> · {p.odds > 0 ? "+" : ""}{p.odds} · {p.edge}% edge
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                  <span style={{
                    fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 6,
                    background: p.result === "win" ? "rgba(0,255,135,0.1)" : p.result === "loss" ? "rgba(255,77,77,0.1)" : "rgba(136,136,136,0.1)",
                    color: p.result === "win" ? "#00FF87" : p.result === "loss" ? "#FF4D4D" : "#555",
                  }}>
                    {p.result === "pending" ? "PENDING" : p.result.toUpperCase()}
                    {p.result !== "pending" && p.home_score != null ? ` ${p.away_score}-${p.home_score}` : ""}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === "resolve" && (
          <div>
            <div style={S.sectionLabel}>RESOLVE RESULTS</div>
            <div style={{ fontSize: 13, color: "#444", marginBottom: 16, lineHeight: 1.6 }}>
              Fetches final scores from MLB API and updates pending picks.<br />
              Run this daily after games finish (~midnight ET).
            </div>
            {/* Resolve buttons for last 7 days */}
            {Array.from({ length: 7 }, (_, i) => {
              const d = new Date();
              d.setDate(d.getDate() - i);
              return d.toISOString().split("T")[0];
            }).map(date => (
              <div key={date} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <span style={{ fontSize: 13, color: "#555", fontFamily: "'JetBrains Mono',monospace", flex: 1 }}>{date}</span>
                <button
                  style={S.resolveBtn}
                  onClick={() => resolveDate(date)}
                  disabled={resolving}
                >
                  {resolving ? "…" : "Resolve"}
                </button>
              </div>
            ))}
            {resolveMsg && <div style={{ fontSize: 13, color: "#00FF87", marginTop: 12 }}>{resolveMsg}</div>}
            <div style={{ ...S.sectionLabel, marginTop: 20 }}>AUTO-RESOLVE (coming soon)</div>
            <div style={{ fontSize: 12, color: "#333", lineHeight: 1.6 }}>
              Set up a Vercel cron job to auto-resolve nightly:<br />
              vercel.json → crons: [&#123; "path": "/api/admin/tracker", "schedule": "0 6 * * *" &#125;]<br />
              Then add action=resolve+date=yesterday to the cron POST body.
            </div>
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
  pill:       { padding: "4px 12px", borderRadius: 20, fontSize: 12, fontWeight: 700, border: "1px solid #1a1a1a" },
  grid4:      { display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8, marginBottom: 8 },
  grid3:      { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 16 },
  statCard:   { background: "#080808", border: "1px solid #1a1a1a", borderRadius: 10, padding: "12px 10px", textAlign: "center" },
  statVal:    { fontSize: 18, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", marginBottom: 4 },
  statLabel:  { fontSize: 10, color: "#333", letterSpacing: 0.5 },
  tabs:       { display: "flex", gap: 4, marginBottom: 16, borderBottom: "1px solid #111", paddingBottom: 8 },
  tabBtn:     { padding: "4px 12px", borderRadius: 6, fontSize: 12, fontWeight: 600, background: "transparent", border: "1px solid transparent" },
  sectionLabel: { fontSize: 10, fontWeight: 700, color: "#333", letterSpacing: 1.5, marginBottom: 10 },
  row:        { display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: "1px solid #0d0d0d" },
  rowDate:    { fontSize: 12, color: "#555", fontFamily: "'JetBrains Mono',monospace", minWidth: 90 },
  rowRecord:  { fontSize: 13, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", minWidth: 40 },
  rowPct:     { fontSize: 13, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", minWidth: 40 },
  tierBadge:  { fontSize: 12, fontWeight: 700, minWidth: 80 },
  pickRow:    { background: "#080808", border: "1px solid", borderRadius: 10, padding: 12, marginBottom: 8, display: "flex", alignItems: "flex-start", gap: 10 },
  resolveBtn: { padding: "6px 14px", borderRadius: 8, background: "#0d0d0d", border: "1px solid #1a1a1a", color: "#00FF87", fontSize: 12, fontWeight: 700 },
  center:     { display: "flex", justifyContent: "center", padding: 60 },
  spinner:    { width: 24, height: 24, border: "2px solid #1a1a1a", borderTopColor: "#00FF87", borderRadius: "50%", animation: "spin 0.7s linear infinite" },
};
