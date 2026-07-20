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

function etDate(offset = 0) {
  const d = new Date(Date.now() + offset * 86400000);
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  return `${p.find(x => x.type === "year").value}-${p.find(x => x.type === "month").value}-${p.find(x => x.type === "day").value}`;
}
function fmtOdds(o) { return o == null ? "—" : o > 0 ? `+${o}` : `${o}`; }
function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/Chicago" }) + " CT";
}
function shortTeam(t) {
  const m = {"Los Angeles Dodgers":"Dodgers","New York Yankees":"Yankees","New York Mets":"Mets","Chicago White Sox":"White Sox","Chicago Cubs":"Cubs","Boston Red Sox":"Red Sox","Tampa Bay Rays":"Rays","San Francisco Giants":"Giants","San Diego Padres":"Padres","Kansas City Royals":"Royals","Toronto Blue Jays":"Blue Jays","Colorado Rockies":"Rockies","Los Angeles Angels":"Angels","Seattle Mariners":"Mariners","Houston Astros":"Astros","Texas Rangers":"Rangers","Cleveland Guardians":"Guardians","Detroit Tigers":"Tigers","Baltimore Orioles":"Orioles","Atlanta Braves":"Braves","Philadelphia Phillies":"Phillies","Washington Nationals":"Nationals","Miami Marlins":"Marlins","Pittsburgh Pirates":"Pirates","St. Louis Cardinals":"Cardinals","Milwaukee Brewers":"Brewers","Cincinnati Reds":"Reds","Arizona Diamondbacks":"D-backs","Minnesota Twins":"Twins","Oakland Athletics":"Athletics"};
  return m[t] || t.split(" ").pop();
}

const css = `*{box-sizing:border-box;margin:0;padding:0;}body{background:#000;color:#fff;font-family:'Space Grotesk',sans-serif;}input,textarea{outline:none;}button{cursor:pointer;font-family:inherit;}a{color:#00FF87;text-decoration:none;}`;
const S = {
  page:  { minHeight: "100vh", background: "#000", padding: "20px 16px", maxWidth: 640, margin: "0 auto" },
  card:  { background: "#0a0a0a", border: "1px solid #1a1a1a", borderRadius: 14, padding: "14px 16px", marginBottom: 10 },
  lbl:   { fontSize: 10, fontWeight: 700, color: "#555", letterSpacing: 2, marginBottom: 8, display: "block" },
  row:   { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 },
  btn:   { border: "1px solid #333", borderRadius: 8, padding: "9px 14px", fontSize: 12, fontWeight: 700, background: "#111", color: "#fff", cursor: "pointer" },
  input: { background: "#111", border: "1px solid #222", borderRadius: 8, padding: "10px 12px", color: "#fff", fontSize: 13, width: "100%" },
  mono:  { fontFamily: "'JetBrains Mono',monospace" },
};

// Converts a raw CLV percentage-point value into a simple 0-10 scale (same
// scale the app already uses for pick confidence) so individual numbers like
// "+13.99pp" become an easy-to-scan "10/10" instead. 5 = neutral (0pp),
// every 1pp of CLV is worth 0.5 scale points, capped at the ends.
function clvScale(pp) {
  if (pp == null) return null;
  return Math.max(0, Math.min(10, Math.round((5 + pp / 2) * 10) / 10));
}
function fmtClv(pp) {
  const s = clvScale(pp);
  return s == null ? "—" : `${s}/10`;
}

function Chip({ label, value, color, sub }) {
  const c = color || "#fff";
  return (
    <div style={{ flex: 1, background: "#0a0a0a", border: "1px solid #1a1a1a", borderRadius: 12, padding: "11px 13px" }}>
      <div style={{ fontSize: 10, color: "#555", letterSpacing: 1.5, marginBottom: 5 }}>{label}</div>
      <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 18, fontWeight: 700, color: c }}>{value ?? "—"}</div>
      {sub && <div style={{ fontSize: 10, color: "#444", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function Btn({ onClick, disabled, state, labels, style = {} }) {
  const s = state;
  const bg = s === "ok" ? "rgba(0,255,135,0.08)" : s === "err" ? "rgba(255,77,77,0.08)" : "#111";
  const cl = s === "ok" ? "#00FF87" : s === "err" ? "#FF4D4D" : "#fff";
  const bd = s === "ok" ? "rgba(0,255,135,0.2)" : s === "err" ? "rgba(255,77,77,0.2)" : "#333";
  return (
    <button onClick={onClick} disabled={disabled || s === "loading"}
      style={{ ...S.btn, background: bg, color: cl, border: `1px solid ${bd}`, ...style }}>
      {s === "loading" ? (labels?.loading || "…") : s === "ok" ? (labels?.ok || "✓ Done") : s === "err" ? (labels?.err || "✗ Failed") : (labels?.default || "Run")}
    </button>
  );
}

const NAVS = ["overview", "picks", "clv", "cal", "codes", "email", "tweet", "system"];
const NAV_LABELS = { overview: "📊 Overview", picks: "⚾ Picks", clv: "📈 CLV", cal: "📐 Calibration", codes: "🔑 Codes", email: "✉️ Email", tweet: "𝕏 Tweet", system: "⚙️ System" };

export default function AdminDash() {
  const [auth, setAuth]   = useState(false);
  const [token, setToken] = useState("");
  const [busy, setBusy]   = useState(true);
  const [tab, setTab]     = useState("overview");

  // data
  const [stats, setStats]   = useState(null);
  const [codes, setCodes]   = useState([]);
  const [picks, setPicks]   = useState([]);
  const [emailCount, setEC] = useState(null);
  const [subCount, setSC]   = useState(null);
  const [pending, setPend]  = useState([]);
  const [allTimePicks, setATP] = useState([]);
  const [modelRec, setModelRec] = useState(null);
  const [calData, setCal] = useState(null);
  const [calHistory, setCalHistory] = useState([]);
  const [autoEnabled, setAutoEnabled] = useState(true);

  // form state
  const [codeLabel, setCL]      = useState("");
  const [codeMax, setCM]        = useState("");
  const [testEmail, setTE]      = useState("");

  // action state
  const [regenS, setRegenS]     = useState(null);
  const [playerIdxS, setPlayerIdxS] = useState(null);
  const [resolveS, setResolveS] = useState(null);
  const [createS, setCreateS]   = useState(null);
  const [testS, setTestS]       = useState(null);
  const [copied, setCopied]     = useState({});
  const [autoToggleS, setAutoToggleS] = useState(null);
  const [activateS, setActivateS]     = useState(null); // { id, state: "loading"|"ok"|"err" }

  useEffect(() => {
    getSB().auth.getSession().then(async ({ data: { session } }) => {
      const email = session?.user?.email?.toLowerCase();
      if (email && ADMIN_EMAILS.includes(email)) {
        setAuth(true);
        setToken(session.access_token);
        setTE(session.user.email);
        load(session.access_token, true);
      } else {
        setBusy(false);
      }
    });
  }, []);

  async function load(tok, autoRegen = false) {
    setBusy(true);
    const h = { Authorization: `Bearer ${tok}` };

    const [statsR, codesR, pendR, recR, calR, calAdminR] = await Promise.all([
      fetch("/api/admin/tracker?action=stats&days=30", { headers: h }).then(r => r.json()).catch(() => null),
      fetch("/api/admin/codes", { headers: h }).then(r => r.json()).catch(() => ({ codes: [] })),
      fetch("/api/admin/tracker?action=pending", { headers: h }).then(r => r.json()).catch(() => ({ pending: [] })),
      fetch("/api/model-record").then(r => r.json()).catch(() => null),
      fetch("/api/calibration").then(r => r.json()).catch(() => null),
      fetch("/api/admin/calibration", { headers: h }).then(r => r.json()).catch(() => null),
    ]);

    const todayPicks = statsR?.todayPicks || [];
    setStats(statsR);
    setCodes(codesR.codes || []);
    setPicks(todayPicks);
    setEC(statsR?.emailCount ?? 0);
    setSC(statsR?.subCount   ?? 0);
    setPend(pendR.pending || []);
    setATP(statsR?.recent || []);
    setModelRec(recR ?? null);
    setCal(calR ?? null);
    setCalHistory(calAdminR?.history ?? []);
    setAutoEnabled(calAdminR?.autoEnabled ?? true);
    setBusy(false);

    // Auto-regen if no picks for today yet
    if (autoRegen && todayPicks.length === 0) {
      setRegenS("loading");
      fetch("/api/admin/regen", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
        body: JSON.stringify({}),
      }).then(r => {
        setRegenS(r.ok ? "ok" : "err");
        if (r.ok) setTimeout(() => load(tok), 8000);
      }).catch(() => setRegenS("err"))
        .finally(() => setTimeout(() => setRegenS(null), 10000));
    }
  }

  // Computed
  const today = etDate(0);
  const todayBets   = picks.filter(p => p.isBet).length;
  const todayClean  = picks.filter(p => p.filter?.verdict === "CLEAN").length;
  const hasBreaks   = picks.some(p => p.breakdown?.preview);

  const atWins = stats?.allTime?.wins  ?? 0;
  const atLoss = stats?.allTime?.losses ?? 0;
  const atPct  = stats?.allTime?.winPct ?? null;
  const atTotal = stats?.allTime?.settled ?? 0;

  const cutoff30 = etDate(-30);
  const recent30 = allTimePicks.filter(p => p.date >= cutoff30);
  const r30s   = recent30.filter(p => ["win","loss"].includes(p.result));
  const r30W   = r30s.filter(p => p.result === "win").length;
  const r30L   = r30s.filter(p => p.result === "loss").length;
  const r30Pct = r30s.length ? ((r30W / r30s.length) * 100).toFixed(1) : null;

  const bets = picks.filter(p => p.isBet).sort((a,b) => {
    const vr = { CLEAN:3, BET:2 };
    return (vr[b.filter?.verdict]||0) - (vr[a.filter?.verdict]||0);
  }).slice(0, 5);

  function buildTweet(p, i) {
    const verdict = p.filter?.verdict === "CLEAN" ? "🔥 CLEAN" : "✅ BET";
    const odds = p.pick === p.homeTeam ? fmtOdds(p.homeOdds) : fmtOdds(p.awayOdds);
    const edge = p.filter?.trueEdgePct ? `+${p.filter.trueEdgePct}% edge` : p.edge ? `+${p.edge.toFixed(1)}% edge` : "";
    const preview = p.breakdown?.preview ? `\n${p.breakdown.preview.slice(0,120)}${p.breakdown.preview.length>120?"…":""}` : "";
    return `${i+1}/${bets.length} — ${verdict}\n${shortTeam(p.awayTeam)} @ ${shortTeam(p.homeTeam)}\nTake ${shortTeam(p.pick)} ${odds} ${edge}${preview}\n\nthisthatpicks.com | @ThisorThatPicks`;
  }

  function copyText(key, text) {
    navigator.clipboard.writeText(text);
    setCopied(prev => ({ ...prev, [key]: true }));
    setTimeout(() => setCopied(prev => ({ ...prev, [key]: false })), 2000);
  }

  async function regen() {
    setRegenS("loading");
    try {
      const r = await fetch("/api/admin/regen", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({}),
      });
      setRegenS(r.ok ? "ok" : "err");
      if (r.ok) setTimeout(() => load(token), 5000);
    } catch { setRegenS("err"); }
    setTimeout(() => setRegenS(null), 8000);
  }

  // Rebuilds the player_index table (see sql/008_player_index.sql) that
  // app/api/search reads player results from. Needed once right after this
  // feature deploys — the cron that keeps it fresh otherwise runs every 6h.
  async function regenPlayerIndex() {
    setPlayerIdxS("loading");
    try {
      const r = await fetch("/api/admin/regen", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ type: "player-index" }),
      });
      setPlayerIdxS(r.ok ? "ok" : "err");
    } catch { setPlayerIdxS("err"); }
    setTimeout(() => setPlayerIdxS(null), 8000);
  }

  async function toggleAutoRecalibration() {
    setAutoToggleS("loading");
    try {
      const r = await fetch("/api/admin/calibration", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: "set-auto", enabled: !autoEnabled }),
      });
      const d = await r.json();
      if (r.ok) { setAutoEnabled(d.autoEnabled); setAutoToggleS("ok"); }
      else setAutoToggleS("err");
    } catch { setAutoToggleS("err"); }
    setTimeout(() => setAutoToggleS(null), 3000);
  }

  async function activateCurve(id) {
    setActivateS({ id, state: "loading" });
    try {
      const r = await fetch("/api/admin/calibration", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: "activate", id }),
      });
      const d = await r.json();
      if (r.ok) {
        setAutoEnabled(d.autoEnabled);
        setActivateS({ id, state: "ok" });
        load(token);
      } else {
        setActivateS({ id, state: "err" });
      }
    } catch { setActivateS({ id, state: "err" }); }
    setTimeout(() => setActivateS(null), 3000);
  }

  async function resolveYesterday() {
    setResolveS("loading");
    try {
      const r = await fetch("/api/admin/tracker", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: "resolve", date: etDate(-1) }),
      });
      const d = await r.json();
      setResolveS(d.resolved != null ? `ok:Resolved ${d.resolved}/${d.total}` : "err");
      load(token);
    } catch { setResolveS("err"); }
    setTimeout(() => setResolveS(null), 5000);
  }

  async function createCode() {
    setCreateS("loading");
    const r = await fetch("/api/admin/codes", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ label: codeLabel || "Unnamed", uses_max: codeMax ? parseInt(codeMax) : null }),
    });
    const d = await r.json();
    if (d.code) { setCL(""); setCM(""); load(token); setCreateS("ok"); }
    else setCreateS("err");
    setTimeout(() => setCreateS(null), 3000);
  }

  async function deleteCode(id) {
    await fetch(`/api/admin/codes?id=${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
    setCodes(prev => prev.filter(c => c.id !== id));
  }

  async function sendTest() {
    if (!testEmail) return;
    setTestS("loading");
    try {
      const r = await fetch("/api/admin/send-test", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ to: testEmail }),
      });
      const d = await r.json();
      setTestS(d.ok ? "ok" : `err:${d.error || "send failed"}`);
    } catch (e) { setTestS(`err:${e.message}`); }
    setTimeout(() => setTestS(null), 6000);
  }

  // ──── RENDER ────────────────────────────────────────────────

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
        <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 20, fontWeight: 700, marginBottom: 12 }}>T<span style={{ color: "#00FF87" }}>|</span>T</div>
        <div style={{ color: "#FF4D4D", fontSize: 13, marginBottom: 12 }}>Not authorized</div>
        <a href="/app" style={{ fontSize: 12, color: "#555" }}>← Sign in first</a>
      </div>
    </div>
  );

  const resolveLabel = resolveS?.startsWith("ok:") ? resolveS.slice(3) : resolveS === "loading" ? "Resolving…" : resolveS === "err" ? "✗ Failed" : "Resolve Yesterday";
  const testLabel = testS?.startsWith("err:") ? `✗ ${testS.slice(4)}` : testS === "loading" ? "Sending…" : testS === "ok" ? "✓ Sent — check inbox" : "Send Test Email";
  const testColor = testS === "ok" ? "#00FF87" : testS?.startsWith("err:") ? "#FF4D4D" : "#fff";

  return (
    <div style={S.page}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&family=JetBrains+Mono:wght@400;700&display=swap');${css}@keyframes spin{to{transform:rotate(360deg)}}`}</style>

      {/* Header */}
      <div style={{ ...S.row, marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 10, color: "#444", letterSpacing: 2 }}>ADMIN</div>
          <div style={{ ...S.mono, fontSize: 20, fontWeight: 700, marginTop: 1 }}>T<span style={{ color: "#00FF87" }}>|</span>T Dashboard</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {busy && <div style={{ width: 14, height: 14, border: "2px solid #222", borderTopColor: "#00FF87", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />}
          <a href="/admin/backtest" style={{ fontSize: 11, color: "#444" }}>Backtest →</a>
          <a href="/app" style={{ fontSize: 11, color: "#444" }}>← App</a>
        </div>
      </div>

      {/* Nav */}
      <div style={{ display: "flex", gap: 5, overflowX: "auto", marginBottom: 20, paddingBottom: 2 }}>
        {NAVS.map(n => (
          <button key={n} onClick={() => setTab(n)}
            style={{ ...S.btn, whiteSpace: "nowrap", background: tab === n ? "#00FF87" : "#111", color: tab === n ? "#000" : "#666", border: `1px solid ${tab === n ? "#00FF87" : "#222"}`, fontWeight: tab === n ? 800 : 600, padding: "7px 12px" }}>
            {NAV_LABELS[n]}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW ── */}
      {tab === "overview" && (
        <>
          <span style={S.lbl}>ALL-TIME RECORD</span>
          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            <Chip label="WINS"    value={atWins}  color="#00FF87" />
            <Chip label="LOSSES"  value={atLoss}  color="#FF4D4D" />
            <Chip label="WIN RATE" value={atPct ? `${atPct}%` : "—"} sub={`${atTotal} settled`}
              color={parseFloat(atPct) >= 55 ? "#00FF87" : parseFloat(atPct) >= 50 ? "#FFD600" : atPct ? "#FF4D4D" : "#fff"} />
          </div>

          <span style={S.lbl}>LAST 30 DAYS</span>
          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            <Chip label="RECORD" value={r30s.length ? `${r30W}-${r30L}` : "—"} />
            <Chip label="WIN %" value={r30Pct ? `${r30Pct}%` : "—"}
              color={parseFloat(r30Pct) >= 55 ? "#00FF87" : parseFloat(r30Pct) >= 50 ? "#FFD600" : r30Pct ? "#FF4D4D" : "#fff"} />
            <Chip label="PENDING" value={pending.length} sub="all dates" />
          </div>

          <span style={S.lbl}>TODAY — {today}</span>
          <div style={{ ...S.card, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Chip label="GAMES"  value={picks.length} />
            <Chip label="BETS"   value={todayBets}  color={todayBets > 0 ? "#00FF87" : "#fff"} />
            <Chip label="CLEAN"  value={todayClean} color={todayClean > 0 ? "#00FF87" : "#fff"} />
            <Chip label="BREAKDOWNS" value={hasBreaks ? "✓" : "✗"} color={hasBreaks ? "#00FF87" : "#FF4D4D"} />
          </div>

          <span style={S.lbl}>USERS</span>
          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            <Chip label="ACTIVE SUBS" value={subCount} color="#00FF87" />
            <Chip label="EMAIL LIST"  value={emailCount} />
            <Chip label="CODES"       value={codes.length} />
          </div>

          <span style={S.lbl}>QUICK ACTIONS</span>
          <div style={{ ...S.card, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Btn onClick={regen} state={regenS} style={{ flex: 1 }}
              labels={{ loading: "⏳ Generating…", ok: "✓ Done", err: "✗ Failed", default: "⚡ Regen Picks" }} />
            <button onClick={() => setTab("email")}  style={{ ...S.btn, flex: 1 }}>✉️ Test Email</button>
            <button onClick={resolveYesterday}        style={{ ...S.btn, flex: 1 }}>{resolveLabel}</button>
            <Btn onClick={regenPlayerIndex} state={playerIdxS} style={{ flex: 1 }}
              labels={{ loading: "⏳ Crawling rosters…", ok: "✓ Done", err: "✗ Failed", default: "🔎 Rebuild Search Index" }} />
          </div>
        </>
      )}

      {/* ── PICKS ── */}
      {tab === "picks" && (
        <>
          <span style={S.lbl}>TODAY'S PICKS — {today}</span>
          <div style={{ ...S.card, marginBottom: 14 }}>
            <div style={{ fontSize: 12, color: "#666", marginBottom: 12 }}>
              {picks.length} games · {todayBets} BET · {todayClean} CLEAN · breakdowns: <strong style={{ color: hasBreaks ? "#00FF87" : "#FF4D4D" }}>{hasBreaks ? "YES ✓" : "NO ✗"}</strong>
            </div>
            <Btn onClick={regen} state={regenS}
              labels={{ loading: "⏳ Generating (~60s)…", ok: "✓ Done — refresh in 5s", err: "✗ Failed", default: "⚡ Force Regen Picks + Breakdowns" }} />
            {regenS === "loading" && (
              <div style={{ fontSize: 11, color: "#555", marginTop: 8 }}>Claude is analyzing all {picks.length} games. This takes ~60 seconds. Picks will auto-refresh.</div>
            )}
          </div>

          {picks.length > 0 && picks.map((p, i) => (
            <div key={p.id || i} style={{ ...S.card, padding: "11px 13px" }}>
              <div style={{ ...S.row, marginBottom: 5 }}>
                <span style={{ ...S.mono, fontSize: 11, fontWeight: 700, color: p.filter?.verdict === "CLEAN" ? "#00FF87" : p.isBet ? "#FFD600" : "#444" }}>
                  {p.filter?.verdict || (p.isBet ? "BET" : "PASS")}
                </span>
                <span style={{ fontSize: 10, color: "#444" }}>{p.commenceTime ? fmtTime(p.commenceTime) : ""}</span>
              </div>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{shortTeam(p.awayTeam)} @ {shortTeam(p.homeTeam)}</div>
              <div style={{ fontSize: 11, color: "#00FF87", marginTop: 3 }}>
                Take {shortTeam(p.pick)} · {p.pick === p.homeTeam ? fmtOdds(p.homeOdds) : fmtOdds(p.awayOdds)} · {p.edge?.toFixed(1)}% edge
              </div>
              {p.breakdown?.pitcher_home && (
                <div style={{ fontSize: 10, color: "#444", marginTop: 4 }}>
                  🏠 {p.breakdown.pitcher_home} · ✈️ {p.breakdown.pitcher_away}
                </div>
              )}
              {p.breakdown?.preview && (
                <div style={{ fontSize: 11, color: "#666", marginTop: 6, lineHeight: 1.5, paddingTop: 6, borderTop: "1px solid #111" }}>{p.breakdown.preview}</div>
              )}
            </div>
          ))}
        </>
      )}

      {/* ── CODES ── */}
      {tab === "codes" && (
        <>
          <span style={S.lbl}>CREATE ACCESS CODE</span>
          <div style={{ ...S.card, marginBottom: 14 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <input style={S.input} placeholder="Label (e.g. brother Mike)" value={codeLabel} onChange={e => setCL(e.target.value)} />
              <input style={S.input} placeholder="Max uses (blank = unlimited)" type="number" value={codeMax} onChange={e => setCM(e.target.value)} />
              <Btn onClick={createCode} state={createS} labels={{ loading: "Creating…", ok: "✓ Created", err: "✗ Failed", default: "Generate Code" }}
                style={{ background: "#00FF87", color: "#000", border: "none", fontWeight: 800 }} />
            </div>
          </div>

          <span style={S.lbl}>ACTIVE CODES ({codes.length})</span>
          {codes.length === 0 && <div style={{ color: "#555", fontSize: 13, padding: "16px 0" }}>No codes yet</div>}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {codes.map(c => (
              <div key={c.id} style={{ ...S.card, ...S.row }}>
                <div>
                  <div style={{ ...S.mono, fontSize: 16, fontWeight: 700, color: "#00FF87", letterSpacing: 2 }}>{c.code}</div>
                  <div style={{ fontSize: 11, color: "#555", marginTop: 2 }}>{c.label || "Unnamed"} · {c.uses_count}/{c.uses_max ?? "∞"} uses</div>
                  {c.expires_at && <div style={{ fontSize: 10, color: "#333", marginTop: 1 }}>Expires {new Date(c.expires_at).toLocaleDateString()}</div>}
                </div>
                <button onClick={() => deleteCode(c.id)}
                  style={{ ...S.btn, color: "#FF4D4D", border: "1px solid rgba(255,77,77,0.2)", background: "rgba(255,77,77,0.06)", padding: "6px 12px" }}>
                  Delete
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── EMAIL ── */}
      {tab === "email" && (
        <>
          <span style={S.lbl}>TEST EMAIL</span>
          <div style={{ ...S.card, marginBottom: 14 }}>
            <div style={{ fontSize: 12, color: "#666", marginBottom: 10, lineHeight: 1.6 }}>
              Sends a test email with today's top pick to verify your Resend setup is working.
              If this fails, your <code style={{ color: "#fff", background: "#111", padding: "1px 5px", borderRadius: 4 }}>RESEND_FROM</code> domain is not verified.
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input style={{ ...S.input }} placeholder="Send test to email…" value={testEmail} onChange={e => setTE(e.target.value)} />
              <button onClick={sendTest} disabled={!testEmail || testS === "loading"}
                style={{ ...S.btn, flexShrink: 0, color: testColor, background: testS === "ok" ? "rgba(0,255,135,0.08)" : testS?.startsWith("err:") ? "rgba(255,77,77,0.08)" : "#111", border: `1px solid ${testS === "ok" ? "rgba(0,255,135,0.3)" : testS?.startsWith("err:") ? "rgba(255,77,77,0.3)" : "#333"}` }}>
                {testLabel}
              </button>
            </div>
          </div>

          <span style={S.lbl}>EMAIL CONFIGURATION</span>
          <div style={S.card}>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {[
                ["From address",   "RESEND_FROM env var (defaults to onboarding@resend.dev)"],
                ["Subscribers",    `${emailCount ?? "?"} on email_list`],
                ["Cron schedule",  "10:30 AM CT daily (30 15 * * * UTC)"],
                ["Domain",         "thisthatpicks.com — must be verified in Resend dashboard"],
              ].map(([k, v]) => (
                <div key={k} style={S.row}>
                  <span style={{ fontSize: 12, color: "#555", flexShrink: 0 }}>{k}</span>
                  <span style={{ fontSize: 12, color: "#888", textAlign: "right" }}>{v}</span>
                </div>
              ))}
            </div>
          </div>

          <span style={S.lbl}>HOW TO FIX DOMAIN (if emails fail)</span>
          <div style={S.card}>
            <div style={{ fontSize: 12, color: "#666", lineHeight: 1.8 }}>
              1. Go to <a href="https://resend.com/domains" target="_blank">resend.com/domains</a><br/>
              2. Add domain <code style={{ color: "#fff" }}>thisthatpicks.com</code><br/>
              3. Add the DNS records they give you to your domain registrar<br/>
              4. Once verified, set env var in Vercel:<br/>
              <code style={{ color: "#00FF87" }}>RESEND_FROM = T|T Picks &lt;picks@thisthatpicks.com&gt;</code>
            </div>
          </div>

          <span style={S.lbl}>OR — USE YOUR OWN EMAIL (no domain needed)</span>
          <div style={S.card}>
            <div style={{ fontSize: 12, color: "#666", lineHeight: 1.8, marginBottom: 8 }}>
              Resend allows sending from any email you registered with. Set this in Vercel env vars:
            </div>
            <pre style={{ ...S.mono, fontSize: 11, color: "#00FF87", background: "#060606", padding: "10px 12px", borderRadius: 8, lineHeight: 1.6 }}>RESEND_FROM = T|T Picks &lt;mmarshall1011@icloud.com&gt;</pre>
            <div style={{ fontSize: 11, color: "#444", marginTop: 6 }}>Note: Resend free plan requires your own email or a verified domain.</div>
          </div>
        </>
      )}

      {/* ── TWEET ── */}
      {tab === "tweet" && (
        <>
          {!hasBreaks && (
            <div style={{ ...S.card, marginBottom: 14, border: "1px solid rgba(255,214,0,0.2)", background: "rgba(255,214,0,0.04)" }}>
              <div style={{ fontSize: 12, color: "#FFD600" }}>⚠️ No breakdowns yet — go to Picks tab → ⚡ Regen for better tweet content</div>
            </div>
          )}

          {bets.length === 0 && (
            <div style={{ color: "#555", fontSize: 13, padding: "16px 0" }}>No BET picks today</div>
          )}

          {bets.length > 0 && (
            <>
              <div style={{ ...S.row, marginBottom: 12 }}>
                <span style={S.lbl}>TODAY'S TWEET THREAD ({bets.length} picks)</span>
                <button onClick={() => copyText("all", bets.map((p,i) => buildTweet(p,i)).join("\n\n---\n\n"))}
                  style={{ ...S.btn, color: copied.all ? "#00FF87" : "#fff", border: `1px solid ${copied.all ? "rgba(0,255,135,0.3)" : "#333"}`, padding: "6px 12px", fontSize: 11 }}>
                  {copied.all ? "✓ Copied All" : "Copy All"}
                </button>
              </div>

              {bets.map((p, i) => (
                <div key={p.id || i} style={{ ...S.card }}>
                  <div style={{ ...S.row, marginBottom: 8 }}>
                    <span style={{ fontSize: 10, color: "#444", fontWeight: 700 }}>TWEET {i + 1}/{bets.length}</span>
                    <button onClick={() => copyText(i, buildTweet(p, i))}
                      style={{ ...S.btn, padding: "5px 10px", fontSize: 11, color: copied[i] ? "#00FF87" : "#fff", border: `1px solid ${copied[i] ? "rgba(0,255,135,0.3)" : "#333"}`, background: copied[i] ? "rgba(0,255,135,0.08)" : "#111" }}>
                      {copied[i] ? "✓ Copied" : "Copy"}
                    </button>
                  </div>
                  <pre style={{ fontSize: 12, color: "#bbb", lineHeight: 1.8, fontFamily: "'Space Grotesk',sans-serif", whiteSpace: "pre-wrap", wordBreak: "break-word", background: "#060606", padding: "10px 12px", borderRadius: 8, margin: 0 }}>
                    {buildTweet(p, i)}
                  </pre>
                </div>
              ))}
            </>
          )}
        </>
      )}

      {/* ── CLV ── */}
      {tab === "clv" && (
        <>
          <span style={S.lbl}>CLOSING LINE VALUE (CLV)</span>
          <div style={{ fontSize: 11, color: "#444", marginBottom: 14, lineHeight: 1.6 }}>
            CLV = did the line move in your favor after you picked it? Shown on a 0–10 scale —
            5 is neutral, higher is better, lower is worse. Healthy models average above 5.
          </div>

          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            <Chip label="AVG CLV"
              value={fmtClv(modelRec?.avgClv)}
              color={modelRec?.avgClv > 0 ? "#00FF87" : modelRec?.avgClv < 0 ? "#FF4D4D" : "#fff"} />
            <Chip label="% POSITIVE"
              value={modelRec?.pctPositiveClv != null ? `${modelRec.pctPositiveClv}%` : "—"}
              color={modelRec?.pctPositiveClv >= 55 ? "#00FF87" : modelRec?.pctPositiveClv >= 45 ? "#FFD600" : modelRec?.pctPositiveClv != null ? "#FF4D4D" : "#fff"} />
            <Chip label="SAMPLES" value={modelRec?.clvSampleSize ?? "—"} sub="picks w/ closing odds" />
          </div>

          <span style={S.lbl}>CLV BY EDGE BUCKET</span>
          {(() => {
            const buckets = modelRec?.edgeBuckets || [];
            const b6 = buckets.find(b => b.label === "6%+");
            const others = buckets.filter(b => b.label !== "6%+" && b.avgClv != null);
            const redFlag = b6?.avgClv != null && (b6.avgClv < 0 || (others.length > 0 && others.every(b => b6.avgClv <= b.avgClv)));
            return (
              <div style={{ ...S.card, marginBottom: 14 }}>
                {redFlag && (
                  <div style={{ fontSize: 11, color: "#FF4D4D", marginBottom: 10, padding: "7px 10px", background: "rgba(255,77,77,0.05)", borderRadius: 6, border: "1px solid rgba(255,77,77,0.15)", lineHeight: 1.6 }}>
                    🚨 Red flag: 6%+ bucket has the worst CLV ({fmtClv(b6.avgClv)}).
                    Large-edge picks are likely model over-amplification, not genuine inefficiency.
                  </div>
                )}
                {buckets.length === 0 && <div style={{ color: "#555", fontSize: 12 }}>No CLV data yet</div>}
                {buckets.length > 0 && (
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                    <thead>
                      <tr style={{ color: "#444", borderBottom: "1px solid #1a1a1a" }}>
                        {["Bucket","W-L","Win%","Avg CLV","n"].map((h, i) => (
                          <th key={h} style={{ textAlign: i === 0 ? "left" : "right", paddingBottom: 8, fontWeight: 600 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {buckets.map(b => {
                        const isBad = redFlag && b.label === "6%+";
                        const clvColor = b.avgClv > 0 ? "#00FF87" : b.avgClv < 0 ? "#FF4D4D" : "#555";
                        const wPctColor = b.pct >= 55 ? "#00FF87" : b.pct >= 50 ? "#FFD600" : b.pct != null ? "#FF4D4D" : "#555";
                        return (
                          <tr key={b.label} style={{ borderBottom: "1px solid #0d0d0d" }}>
                            <td style={{ padding: "7px 0", color: isBad ? "#FF4D4D" : "#ccc" }}>{b.label}{isBad ? " 🚨" : ""}</td>
                            <td style={{ textAlign: "right", ...S.mono, color: "#888" }}>
                              {b.total > 0 ? `${b.wins}-${b.total - b.wins}` : "—"}
                            </td>
                            <td style={{ textAlign: "right", ...S.mono, color: wPctColor }}>
                              {b.pct != null ? `${b.pct}%` : "—"}
                            </td>
                            <td style={{ textAlign: "right", ...S.mono, color: clvColor, fontWeight: 700 }}>
                              {fmtClv(b.avgClv)}
                            </td>
                            <td style={{ textAlign: "right", color: "#555" }}>{b.clvSamples || "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            );
          })()}

          <span style={S.lbl}>PER-PICK CLV LOG</span>
          {(() => {
            const clvPicks = allTimePicks.filter(p => p.features?.clv != null).sort((a, b) => b.date.localeCompare(a.date));
            if (!clvPicks.length) return (
              <div style={{ color: "#555", fontSize: 12, padding: "12px 0" }}>
                No CLV data yet — snapshot cron captures closing odds at 6 PM CT daily
              </div>
            );
            return (
              <div style={S.card}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                  <thead>
                    <tr style={{ color: "#444", borderBottom: "1px solid #1a1a1a" }}>
                      {["Date","Pick","Result","Edge","CLV"].map((h, i) => (
                        <th key={h} style={{ textAlign: i < 2 ? "left" : "right", paddingBottom: 8, fontWeight: 600 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {clvPicks.map((p, i) => {
                      const clv = p.features.clv;
                      const team = p.pick?.split(" ").slice(-1)[0] || p.pick;
                      const resColor = p.result === "win" ? "#00FF87" : p.result === "loss" ? "#FF4D4D" : p.result === "push" ? "#FFD600" : "#555";
                      const clvColor = clv > 0 ? "#00FF87" : clv < 0 ? "#FF4D4D" : "#888";
                      return (
                        <tr key={i} style={{ borderBottom: "1px solid #0a0a0a" }}>
                          <td style={{ padding: "6px 0", color: "#555" }}>{p.date}</td>
                          <td style={{ padding: "6px 0", color: "#ccc" }}>{team}</td>
                          <td style={{ textAlign: "right", color: resColor, ...S.mono }}>{p.result || "—"}</td>
                          <td style={{ textAlign: "right", color: "#888", ...S.mono }}>
                            {p.edge != null ? `+${parseFloat(p.edge).toFixed(1)}%` : "—"}
                          </td>
                          <td style={{ textAlign: "right", color: clvColor, ...S.mono, fontWeight: 700 }}>
                            {fmtClv(clv)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })()}
        </>
      )}

      {/* ── CALIBRATION ── */}
      {tab === "cal" && (
        <>
          {(() => {
            const daily = [...(stats?.daily || [])].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 14);
            const volume = stats?.dailyVolume || {};
            if (!daily.length) return null;
            return (
              <>
                <span style={S.lbl}>DAILY HEALTH</span>
                <div style={{ fontSize: 11, color: "#444", marginBottom: 10, lineHeight: 1.6 }}>
                  Win rate and bet volume by day — the fast &quot;is this thing working&quot; check.
                </div>
                <div style={{ ...S.card, padding: 0, overflow: "hidden" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                    <thead>
                      <tr style={{ color: "#444", borderBottom: "1px solid #1a1a1a" }}>
                        {["Date", "Bets", "Passed", "W-L", "Win%"].map((h, i) => (
                          <th key={h} style={{ textAlign: i === 0 ? "left" : "right", padding: "8px 12px", fontWeight: 600 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {daily.map(d => {
                        const w = d.wins || 0, l = d.losses || 0;
                        const settled = w + l;
                        const pct = settled > 0 ? Math.round((w / settled) * 1000) / 10 : null;
                        const pctColor = pct == null ? "#333" : pct >= 55 ? "#00FF87" : pct >= 50 ? "#FFD600" : "#FF4D4D";
                        const vol = volume[d.date];
                        const label = new Date(`${d.date}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
                        return (
                          <tr key={d.date} style={{ borderBottom: "1px solid #0d0d0d" }}>
                            <td style={{ padding: "7px 12px", color: "#ccc" }}>{label}</td>
                            <td style={{ textAlign: "right", padding: "7px 12px", ...S.mono, color: "#888" }}>{vol?.bets ?? "—"}</td>
                            <td style={{ textAlign: "right", padding: "7px 12px", ...S.mono, color: "#555" }}>{vol?.passed ?? "—"}</td>
                            <td style={{ textAlign: "right", padding: "7px 12px", ...S.mono, color: "#888" }}>{settled > 0 ? `${w}-${l}` : "—"}</td>
                            <td style={{ textAlign: "right", padding: "7px 12px", ...S.mono, color: pctColor, fontWeight: 700 }}>{pct != null ? `${pct}%` : "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {calData?.recalibration?.fittedAt && (
                  <div style={{ fontSize: 10, color: "#444", marginTop: 8, marginBottom: 14 }}>
                    Model last recalibrated{" "}
                    {new Date(calData.recalibration.fittedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" })} CT
                    {calData.recalibration.gameCount ? ` · fit on ${calData.recalibration.gameCount.toLocaleString()} games` : ""}
                    {calData.recalibration.notes ? ` (${calData.recalibration.notes})` : ""}
                  </div>
                )}
              </>
            );
          })()}

          <span style={{ ...S.lbl, marginTop: 4, display: "block" }}>AUTO-RECALIBRATION</span>
          <div style={{ ...S.card, marginBottom: 14, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: autoEnabled ? "#00FF87" : "#FFD600" }}>
                {autoEnabled ? "Running daily" : "Paused"}
              </div>
              <div style={{ fontSize: 11, color: "#555", marginTop: 3, lineHeight: 1.5 }}>
                {autoEnabled
                  ? "Refits and publishes a new curve every morning after resolve."
                  : "Pinned to a specific curve below — the daily cron won't touch it until you resume."}
              </div>
            </div>
            <Btn onClick={toggleAutoRecalibration} state={autoToggleS}
              labels={{ default: autoEnabled ? "Pause" : "Resume", loading: "…", ok: "✓ Done", err: "✗ Failed" }} />
          </div>

          <span style={{ ...S.lbl, display: "block" }}>CALIBRATION HISTORY</span>
          <div style={{ fontSize: 11, color: "#444", marginBottom: 10, lineHeight: 1.6 }}>
            Every past recalibration, cron or manual. If a day&apos;s fit looks worse, go back to one that worked — that also pauses auto-recalibration above.
          </div>
          <div style={{ ...S.card, marginBottom: 14 }}>
            {!calHistory.length && <div style={{ color: "#555", fontSize: 12 }}>No recalibration history yet</div>}
            {calHistory.map(row => {
              const rowBusy = activateS?.id === row.id ? activateS.state : null;
              return (
                <div key={row.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid #0d0d0d" }}>
                  <div>
                    <div style={{ fontSize: 12, color: "#ccc" }}>
                      {new Date(row.fitted_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" })} CT
                    </div>
                    <div style={{ fontSize: 10, color: "#555", marginTop: 2 }}>
                      {row.game_count != null ? row.game_count.toLocaleString() : "—"} games{row.notes ? ` · ${row.notes}` : ""}
                    </div>
                  </div>
                  {row.active ? (
                    <span style={{ fontSize: 10, fontWeight: 700, color: "#00FF87", background: "rgba(0,255,135,0.1)", borderRadius: 6, padding: "5px 9px" }}>ACTIVE</span>
                  ) : (
                    <Btn onClick={() => activateCurve(row.id)} state={rowBusy}
                      labels={{ default: "Use this", loading: "…", ok: "✓ Active", err: "✗ Failed" }}
                      style={{ padding: "6px 10px", fontSize: 11 }} />
                  )}
                </div>
              );
            })}
          </div>

          {(() => {
            const clean = calData?.verdictBuckets?.find(b => b.label === "CLEAN");
            const total = calData?.total ?? 0;
            const delta = calData?.avgDelta;
            const thin  = total < 30;

            if (!total) {
              return (
                <div style={{ ...S.card, marginBottom: 14, textAlign: "center", padding: "22px 16px" }}>
                  <div style={{ fontSize: 30, marginBottom: 6 }}>⏳</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "#ccc" }}>No settled bets yet</div>
                  <div style={{ fontSize: 12, color: "#555", marginTop: 4 }}>
                    Come back once some picks have actually finished — there&apos;s nothing to check yet.
                  </div>
                </div>
              );
            }

            const magnitude = delta == null ? 0 : Math.abs(delta);
            const good  = magnitude <= 2;
            const okish = magnitude > 2 && magnitude <= 5;
            const bad   = magnitude > 5;
            const direction = delta > 0 ? "sandbagging a little (actual results are better than predicted)"
                             : "a bit overconfident (actual results are coming in worse than predicted)";

            const status = good
              ? { emoji: "🟢", color: "#00FF87", headline: "Looking good" }
              : okish
              ? { emoji: "🟡", color: "#FFD600", headline: "A little off" }
              : { emoji: "🔴", color: "#FF4D4D", headline: "Worth a look" };

            return (
              <div style={{ ...S.card, marginBottom: 14, padding: "18px 16px" }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <span style={{ fontSize: 24 }}>{status.emoji}</span>
                  <span style={{ fontSize: 17, fontWeight: 700, color: status.color }}>{status.headline}</span>
                </div>
                <div style={{ fontSize: 13, color: "#aaa", marginTop: 8, lineHeight: 1.6 }}>
                  {good && "When the model says a team has, say, a 60% chance to win, that's holding up pretty close to reality."}
                  {!good && `The model's win-probability estimates are ${direction}, by about ${magnitude.toFixed(1)} points on average.`}
                </div>
                {clean?.n > 0 && (
                  <div style={{ fontSize: 13, color: "#aaa", marginTop: 6, lineHeight: 1.6 }}>
                    Your top-tier (CLEAN) picks have won <b style={{ color: clean.actual >= 55 ? "#00FF87" : clean.actual >= 50 ? "#FFD600" : "#FF4D4D" }}>{clean.actual}%</b> of {clean.n} bets so far.
                  </div>
                )}
                <div style={{ fontSize: 11, color: "#444", marginTop: 10 }}>
                  Based on {total} settled bet{total === 1 ? "" : "s"} total.
                  {thin && " That's a small sample — treat this as an early read, not a final verdict."}
                </div>
              </div>
            );
          })()}

          <span style={S.lbl}>PROBABILITY CALIBRATION</span>
          <div style={{ fontSize: 10, color: "#333", marginBottom: 6 }}>Detail below — the summary above is the short version.</div>
          <div style={{ fontSize: 11, color: "#444", marginBottom: 14, lineHeight: 1.6 }}>
            Does a 57% predicted probability actually win 57% of the time?
            Delta = actual − predicted. Negative = model overconfident. Positive = underconfident.
          </div>
          {calData?.avgDelta != null && (
            <div style={{ ...S.card, marginBottom: 10, display: "flex", gap: 8 }}>
              <Chip
                label="OVERALL BIAS"
                value={`${calData.avgDelta > 0 ? "+" : ""}${calData.avgDelta}pp`}
                color={Math.abs(calData.avgDelta) <= 2 ? "#00FF87" : Math.abs(calData.avgDelta) <= 5 ? "#FFD600" : "#FF4D4D"}
                sub={calData.avgDelta > 2 ? "underconfident" : calData.avgDelta < -2 ? "overconfident" : "well calibrated"}
              />
              <Chip label="RESOLVED BETS" value={calData.total ?? "—"} sub="all-time sample" />
            </div>
          )}
          <div style={S.card}>
            {!calData?.probBuckets?.length && <div style={{ color: "#555", fontSize: 12 }}>No resolved picks yet</div>}
            {calData?.probBuckets?.length > 0 && (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                <thead>
                  <tr style={{ color: "#444", borderBottom: "1px solid #1a1a1a" }}>
                    {["Bucket", "Predicted", "Actual", "Delta", "CLV", "n"].map((h, i) => (
                      <th key={h} style={{ textAlign: i === 0 ? "left" : "right", paddingBottom: 8, fontWeight: 600 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {calData.probBuckets.map(b => {
                    const delta = b.actual != null && b.predicted != null ? parseFloat((b.actual - b.predicted).toFixed(1)) : null;
                    const deltaColor = delta == null ? "#333" : Math.abs(delta) <= 2 ? "#00FF87" : Math.abs(delta) <= 5 ? "#FFD600" : "#FF4D4D";
                    const actColor   = b.actual == null ? "#333" : b.actual >= 55 ? "#00FF87" : b.actual >= 50 ? "#FFD600" : "#FF4D4D";
                    const clvColor   = b.avgClv > 0 ? "#00FF87" : b.avgClv < 0 ? "#FF4D4D" : "#555";
                    const thinSample = b.n < 20;
                    return (
                      <tr key={b.label} style={{ borderBottom: "1px solid #0d0d0d" }}>
                        <td style={{ padding: "7px 0", color: thinSample ? "#444" : "#ccc" }}>{b.label}{thinSample ? " *" : ""}</td>
                        <td style={{ textAlign: "right", ...S.mono, color: "#555" }}>{b.predicted != null ? `${b.predicted}%` : "—"}</td>
                        <td style={{ textAlign: "right", ...S.mono, color: b.actual != null ? actColor : "#333", fontWeight: 700 }}>{b.actual != null ? `${b.actual}%` : "—"}</td>
                        <td style={{ textAlign: "right", ...S.mono, color: deltaColor, fontWeight: 700 }}>{delta != null ? `${delta > 0 ? "+" : ""}${delta}pp` : "—"}</td>
                        <td style={{ textAlign: "right", ...S.mono, color: b.avgClv != null ? clvColor : "#333" }}>{fmtClv(b.avgClv)}</td>
                        <td style={{ textAlign: "right", color: thinSample ? "#333" : "#555" }}>{b.n}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            {calData?.probBuckets?.some(b => b.n < 20 && b.n > 0) && (
              <div style={{ fontSize: 10, color: "#333", marginTop: 8 }}>* n &lt; 20 — too small to interpret</div>
            )}
          </div>

          <span style={{ ...S.lbl, marginTop: 18, display: "block" }}>CONFIDENCE CALIBRATION</span>
          <div style={{ fontSize: 11, color: "#444", marginBottom: 10, lineHeight: 1.6 }}>
            Higher confidence should monotonically produce higher win rate. Non-monotone = miscalibration.
          </div>
          <div style={S.card}>
            {!calData?.confBuckets?.length && <div style={{ color: "#555", fontSize: 12 }}>No data</div>}
            {calData?.confBuckets?.length > 0 && (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                <thead>
                  <tr style={{ color: "#444", borderBottom: "1px solid #1a1a1a" }}>
                    {["Confidence", "W-L", "Win%", "Avg CLV", "n"].map((h, i) => (
                      <th key={h} style={{ textAlign: i === 0 ? "left" : "right", paddingBottom: 8, fontWeight: 600 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {calData.confBuckets.map(b => {
                    const wPctColor = b.actual == null ? "#333" : b.actual >= 55 ? "#00FF87" : b.actual >= 50 ? "#FFD600" : "#FF4D4D";
                    const clvColor  = b.avgClv > 0 ? "#00FF87" : b.avgClv < 0 ? "#FF4D4D" : "#555";
                    return (
                      <tr key={b.label} style={{ borderBottom: "1px solid #0d0d0d" }}>
                        <td style={{ padding: "7px 0", color: "#ccc" }}>{b.label}</td>
                        <td style={{ textAlign: "right", ...S.mono, color: "#888" }}>{b.n > 0 ? `${b.wins}-${b.n - b.wins}` : "—"}</td>
                        <td style={{ textAlign: "right", ...S.mono, color: wPctColor, fontWeight: 700 }}>{b.actual != null ? `${b.actual}%` : "—"}</td>
                        <td style={{ textAlign: "right", ...S.mono, color: b.avgClv != null ? clvColor : "#333" }}>{fmtClv(b.avgClv)}</td>
                        <td style={{ textAlign: "right", color: "#555" }}>{b.n || "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          <span style={{ ...S.lbl, marginTop: 18, display: "block" }}>VERDICT & VARIANCE BREAKDOWN</span>
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            {(calData?.verdictBuckets || []).map(b => (
              <div key={b.label} style={{ flex: 1, background: "#0a0a0a", border: `1px solid ${b.label === "CLEAN" ? "rgba(0,255,135,0.15)" : "#1a1a1a"}`, borderRadius: 12, padding: "11px 13px" }}>
                <div style={{ fontSize: 10, color: b.label === "CLEAN" ? "#00FF87" : "#555", letterSpacing: 1.5, marginBottom: 5 }}>{b.label}</div>
                <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 20, fontWeight: 700, color: b.actual >= 55 ? "#00FF87" : b.actual >= 50 ? "#FFD600" : b.actual != null ? "#FF4D4D" : "#333" }}>
                  {b.actual != null ? `${b.actual}%` : "—"}
                </div>
                <div style={{ fontSize: 10, color: "#444", marginTop: 3 }}>{b.n} bets · {b.wins}W</div>
                {b.avgClv != null && (
                  <div style={{ fontSize: 10, color: b.avgClv > 0 ? "#00FF87" : "#FF4D4D", marginTop: 2 }}>CLV {fmtClv(b.avgClv)}</div>
                )}
              </div>
            ))}
          </div>
          {(calData?.varianceBuckets || []).length > 0 && (
            <div style={{ display: "flex", gap: 8 }}>
              {calData.varianceBuckets.map(b => (
                <div key={b.label} style={{ flex: 1, background: "#0a0a0a", border: "1px solid #1a1a1a", borderRadius: 12, padding: "11px 13px" }}>
                  <div style={{ fontSize: 10, color: "#555", letterSpacing: 1.5, marginBottom: 5 }}>{b.label} VAR</div>
                  <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 20, fontWeight: 700, color: b.actual >= 55 ? "#00FF87" : b.actual >= 50 ? "#FFD600" : b.actual != null ? "#FF4D4D" : "#333" }}>
                    {b.actual != null ? `${b.actual}%` : "—"}
                  </div>
                  <div style={{ fontSize: 10, color: "#444", marginTop: 3 }}>{b.n} bets</div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── SYSTEM ── */}
      {tab === "system" && (
        <>
          <span style={S.lbl}>MANUAL ACTIONS</span>
          <div style={{ ...S.card, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ ...S.row }}>
              <span style={{ fontSize: 12, color: "#777" }}>Resolve yesterday's picks vs MLB final scores</span>
              <button onClick={resolveYesterday} style={{ ...S.btn, flexShrink: 0, color: "#00FF87", border: "1px solid rgba(0,255,135,0.2)", background: "rgba(0,255,135,0.06)" }}>{resolveLabel}</button>
            </div>
          </div>

          <span style={S.lbl}>CRON SCHEDULE (Vercel)</span>
          <div style={S.card}>
            {[
              ["⚾ Picks + Breakdowns", "0 15 * * *",  "10:00 AM CT"],
              ["🔍 Resolve Results",    "0 8 * * *",   "3:00 AM CT"],
              ["✉️ Email Digest",       "30 15 * * *", "10:30 AM CT"],
              ["𝕏 Tweet Bot",          "15 15 * * *", "10:15 AM CT (disabled — X requires paid plan)"],
              ["📸 CLV Snapshot",       "0 23 * * *",  "6:00 PM CT — captures closing odds"],
            ].map(([name, sched, ct]) => (
              <div key={name} style={{ ...S.row, padding: "9px 0", borderBottom: "1px solid #0d0d0d" }}>
                <div>
                  <div style={{ fontSize: 13 }}>{name}</div>
                  <div style={{ fontSize: 11, color: "#444", marginTop: 1 }}>{ct}</div>
                </div>
                <div style={{ ...S.mono, fontSize: 11, color: "#333" }}>{sched}</div>
              </div>
            ))}
          </div>

          <span style={S.lbl}>DASHBOARD LINKS</span>
          <div style={S.card}>
            {[
              ["Vercel Cron Logs", "https://vercel.com/mmarshall6402-7451s-projects/tot-app/settings/crons"],
              ["Vercel Env Vars",  "https://vercel.com/mmarshall6402-7451s-projects/tot-app/settings/environment-variables"],
              ["Supabase Tables",  "https://supabase.com/dashboard/project/yazpmhcdvdbnqwhvrfdp/editor"],
              ["Resend Domains",   "https://resend.com/domains"],
              ["Stripe Dashboard", "https://dashboard.stripe.com"],
            ].map(([label, url]) => (
              <div key={label} style={{ padding: "8px 0", borderBottom: "1px solid #0a0a0a" }}>
                <a href={url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13 }}>{label} ↗</a>
              </div>
            ))}
          </div>

          <span style={S.lbl}>REQUIRED SQL (run in Supabase if not done)</span>
          {[
            { title: "ML features column", sql: "alter table model_picks add column if not exists features jsonb;" },
            { title: "Access codes table", sql: `create table if not exists access_codes (\n  id uuid primary key default gen_random_uuid(),\n  code text unique not null,\n  label text,\n  uses_max int default null,\n  uses_count int default 0,\n  expires_at timestamptz default null,\n  created_at timestamptz default now()\n);\nalter table access_codes enable row level security;\ncreate policy "public read access_codes"\n  on access_codes for select using (true);` },
          ].map(({ title, sql }) => (
            <div key={title} style={{ ...S.card, marginBottom: 8 }}>
              <div style={{ ...S.row, marginBottom: 8 }}>
                <span style={{ fontSize: 11, color: "#555" }}>{title}</span>
                <button onClick={() => copyText(title, sql)} style={{ ...S.btn, padding: "4px 10px", fontSize: 10, color: copied[title] ? "#00FF87" : "#fff" }}>
                  {copied[title] ? "✓" : "Copy"}
                </button>
              </div>
              <pre style={{ ...S.mono, fontSize: 10, color: "#00FF87", whiteSpace: "pre-wrap", lineHeight: 1.6, background: "#060606", padding: "8px 10px", borderRadius: 6, margin: 0 }}>{sql}</pre>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
