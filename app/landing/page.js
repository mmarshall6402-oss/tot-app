"use client";
import { useState, useEffect, useRef } from "react";

export default function Landing() {
  const [freePick, setFreePick]   = useState(null);
  const [record, setRecord]       = useState(null);
  const [email, setEmail]         = useState("");
  const [subStatus, setSubStatus] = useState(null);
  const [errMsg, setErrMsg]       = useState("");
  const heroEmailRef = useRef(null);

  useEffect(() => {
    fetch("/api/free-pick").then(r => r.json()).then(d => setFreePick(d.pick || null)).catch(() => {});
    fetch("/api/model-record").then(r => r.json()).then(d => setRecord(d)).catch(() => {});
  }, []);

  const subscribe = async (e) => {
    e.preventDefault();
    if (!email.trim()) return;
    setSubStatus("loading");
    try {
      const res = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const d = await res.json();
      if (res.ok) { setSubStatus("ok"); }
      else { setSubStatus("err"); setErrMsg(d.error || "Something went wrong."); }
    } catch { setSubStatus("err"); setErrMsg("Network error."); }
  };

  const verdictColor = { CLEAN: "#00FF87", BET: "#FFD600" };
  const verdictLabel = { CLEAN: "🔥 Value Pick", BET: "✅ Solid Pick" };
  const fmtOdds = o => o == null ? "" : o > 0 ? `+${o}` : `${o}`;
  const winPct = record?.pct;
  const rateColor = winPct == null ? "#fff" : winPct >= 58 ? "#00FF87" : winPct >= 52 ? "#FFD600" : "#fff";

  const MOCK_PICKS = [
    { away: "Yankees", home: "Red Sox",    verdict: "CLEAN", pick: "Yankees", odds: "-118", edge: "+4.2%", blur: false },
    { away: "Dodgers", home: "Padres",     verdict: "BET",   pick: "Dodgers", odds: "-132", edge: "+3.1%", blur: false },
    { away: "Astros",  home: "Rangers",    verdict: null,    pick: "Rangers", odds: "+104", edge: null,    blur: true  },
    { away: "Cubs",    home: "Cardinals",  verdict: null,    pick: "Cubs",    odds: "-110", edge: null,    blur: true  },
    { away: "Braves",  home: "Mets",       verdict: null,    pick: "Braves",  odds: "+108", edge: null,    blur: true  },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "#0a0b0f", fontFamily: "'Space Grotesk', sans-serif", color: "#fff", overflowX: "hidden" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;600;700&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: radial-gradient(1400px 700px at 50% -15%, rgba(0,255,135,0.07), transparent 60%), #0a0b0f; }
        input, button, a { font-family: inherit; }
        a { text-decoration: none; }
        ::selection { background: rgba(0,255,135,0.2); }

        @keyframes fadeUp   { from { opacity:0; transform:translateY(24px); } to { opacity:1; transform:translateY(0); } }
        @keyframes fadeIn   { from { opacity:0; } to { opacity:1; } }
        @keyframes pulse    { 0%,100% { opacity:1; } 50% { opacity:.5; } }
        @keyframes shimmer  { 0% { background-position:-400px 0; } 100% { background-position:400px 0; } }
        @keyframes float    { 0%,100% { transform:translateY(0px); } 50% { transform:translateY(-6px); } }

        .fade-up   { animation: fadeUp   0.6s ease both; }
        .fade-up-2 { animation: fadeUp   0.6s ease 0.15s both; }
        .fade-up-3 { animation: fadeUp   0.6s ease 0.3s  both; }
        .fade-up-4 { animation: fadeUp   0.6s ease 0.45s both; }
        .fade-in   { animation: fadeIn   0.8s ease both; }

        .float     { animation: float    4s ease-in-out infinite; }

        .glow-green  { box-shadow: 0 0 40px rgba(0,255,135,0.12); }
        .glow-line   { background: linear-gradient(90deg, transparent, rgba(0,255,135,0.4), transparent); height:1px; width:100%; }

        .pick-card   { background:linear-gradient(155deg, #1c202a, #14161c); border:1px solid #242832; border-radius:14px; padding:14px 16px; transition: border-color .2s, box-shadow .2s; box-shadow: 0 4px 18px rgba(0,0,0,0.35); }
        .pick-card:hover { border-color:#333947; }

        .cta-btn     { background:#00FF87; color:#000; font-weight:800; font-size:15px; padding:15px 32px; border:none; border-radius:12px; cursor:pointer; transition: opacity .15s, transform .15s, box-shadow .15s; display:inline-block; text-align:center; box-shadow: 0 4px 20px rgba(0,255,135,0.25); }
        .cta-btn:hover { opacity:.9; transform:translateY(-1px); box-shadow: 0 6px 26px rgba(0,255,135,0.35); }

        .ghost-btn   { background:transparent; color:#fff; font-weight:700; font-size:14px; padding:13px 28px; border:1px solid #3d424f; border-radius:12px; cursor:pointer; transition: border-color .2s, color .2s; display:inline-block; text-align:center; }
        .ghost-btn:hover { border-color:#555; color:#fff; }

        .stat-card   { background:linear-gradient(155deg, #1c202a, #14161c); border:1px solid #242832; border-radius:16px; padding:22px 20px; flex:1; min-width:140px; box-shadow: 0 4px 18px rgba(0,0,0,0.35); }

        .feature-card { background:linear-gradient(155deg, #17191f, #101216); border:1px solid #242832; border-radius:18px; padding:24px; flex:1; min-width:200px; box-shadow: 0 4px 18px rgba(0,0,0,0.3); }

        .blur-card   { position:relative; overflow:hidden; }
        .blur-mask   { position:absolute; inset:0; backdrop-filter:blur(5px); background:rgba(0,0,0,0.4); border-radius:14px; display:flex; align-items:center; justify-content:center; z-index:2; }
        .lock-badge  { background:rgba(0,0,0,0.8); border:1px solid #2b2f3a; border-radius:8px; padding:6px 12px; font-size:11px; color:#555; font-weight:700; letter-spacing:1px; }

        .testimonial { background:linear-gradient(155deg, #17191f, #101216); border:1px solid #242832; border-radius:16px; padding:22px 20px; box-shadow: 0 4px 18px rgba(0,0,0,0.3); }

        .shimmer-line { background:linear-gradient(90deg,#181b22 25%,#242832 50%,#181b22 75%); background-size:400px 100%; animation: shimmer 1.4s infinite; border-radius:4px; }
      `}</style>

      {/* ─── NAV ──────────────────────────────────────── */}
      <nav style={{ position: "sticky", top: 0, zIndex: 100, background: "rgba(10,11,15,0.85)", backdropFilter: "blur(20px)", borderBottom: "1px solid #1c1f26", padding: "14px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 18, fontWeight: 700, letterSpacing: -0.5 }}>
          T<span style={{ color: "#00FF87" }}>|</span>T
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <a href="https://twitter.com/ThisorThatPicks" target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: "#555", transition: "color .2s" }}>𝕏 @ThisorThatPicks</a>
          <a href="/" className="cta-btn" style={{ fontSize: 13, padding: "9px 20px" }}>Open App →</a>
        </div>
      </nav>

      {/* ─── HERO ─────────────────────────────────────── */}
      <section style={{ padding: "80px 24px 72px", maxWidth: 860, margin: "0 auto", textAlign: "center" }}>
        {/* Live badge */}
        <div className="fade-up" style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "rgba(0,255,135,0.06)", border: "1px solid rgba(0,255,135,0.15)", borderRadius: 40, padding: "6px 14px", marginBottom: 28 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#00FF87", animation: "pulse 1.5s ease-in-out infinite", display: "inline-block" }} />
          <span style={{ fontSize: 11, color: "#00FF87", fontWeight: 700, letterSpacing: 1.5 }}>LIVE TODAY · MLB</span>
        </div>

        <h1 className="fade-up-2" style={{ fontSize: "clamp(40px,8vw,76px)", fontWeight: 800, lineHeight: 1.05, letterSpacing: -2, marginBottom: 22 }}>
          We outperform<br />
          <span style={{ color: "#00FF87" }}>Vegas odds</span><br />
          with data.
        </h1>

        <p className="fade-up-3" style={{ fontSize: "clamp(15px,2.5vw,18px)", color: "#666", lineHeight: 1.65, maxWidth: 560, margin: "0 auto 36px" }}>
          T|T is a sharp MLB model that finds genuine edges the books miss —
          pitcher match-ups, bullpen state, park factors, and line movement. Not gut feelings. Edges.
        </p>

        <div className="fade-up-4" style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap", marginBottom: 48 }}>
          <a href="/" className="cta-btn">Start free →</a>
          <button className="ghost-btn" onClick={() => heroEmailRef.current?.scrollIntoView({ behavior: "smooth" })}>
            Get daily pick by email
          </button>
        </div>

        {/* Hero stat strip */}
        {record?.total > 0 && (
          <div className="fade-in" style={{ display: "inline-flex", gap: 32, background: "#10131a", border: "1px solid #242832", borderRadius: 14, padding: "14px 28px", flexWrap: "wrap", justifyContent: "center" }}>
            {[
              { label: "Win Rate", value: `${winPct}%`, color: rateColor },
              { label: "Record",   value: `${record.wins}-${record.losses}`, color: "#fff" },
              { label: "Picks Tracked", value: `${record.total}+`, color: "#fff" },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ textAlign: "center" }}>
                <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 22, fontWeight: 700, color }}>{value}</div>
                <div style={{ fontSize: 11, color: "#444", marginTop: 2, letterSpacing: 1 }}>{label.toUpperCase()}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="glow-line" style={{ maxWidth: 900, margin: "0 auto" }} />

      {/* ─── APP MOCKUP ───────────────────────────────── */}
      <section style={{ padding: "80px 24px", maxWidth: 520, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div style={{ fontSize: 11, color: "#00FF87", fontWeight: 700, letterSpacing: 2, marginBottom: 10 }}>THE APP</div>
          <h2 style={{ fontSize: "clamp(26px,5vw,38px)", fontWeight: 800, letterSpacing: -1, lineHeight: 1.2 }}>
            Every game. Every edge.<br/>Every morning.
          </h2>
          <p style={{ color: "#555", fontSize: 14, marginTop: 12, lineHeight: 1.6 }}>
            Pro members see all picks, full breakdowns, and edge scores for every game on the board.
          </p>
        </div>

        {/* Phone mockup frame */}
        <div className="float" style={{ background: "#10131a", border: "1px solid #242832", borderRadius: 28, padding: "20px 16px", position: "relative", boxShadow: "0 40px 80px rgba(0,0,0,0.6), 0 0 0 1px #111" }}>
          {/* Status bar */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, padding: "0 4px" }}>
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 14, fontWeight: 700 }}>
              T<span style={{ color: "#00FF87" }}>|</span>T
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              {["⚾ Picks", "💎 Steals", "📊 Tracker"].map(t => (
                <div key={t} style={{ fontSize: 10, color: t === "⚾ Picks" ? "#00FF87" : "#3d424f", fontWeight: 700 }}>{t}</div>
              ))}
            </div>
          </div>

          {/* Stats strip */}
          <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
            {[
              { label: `${freePick ? "15" : "—"} games`, color: "#555" },
              { label: `${freePick ? "4" : "—"} BET ↑`, color: "#00FF87" },
              { label: `⚡ 2 CLEAN`, color: "#00FF87" },
            ].map(({ label, color }) => (
              <div key={label} style={{ fontSize: 10, color, fontWeight: 700 }}>{label}</div>
            ))}
          </div>

          {/* Live pick (from API) */}
          {freePick && (
            <div className="pick-card glow-green" style={{ marginBottom: 8, borderColor: "rgba(0,255,135,0.2)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontSize: 10, color: "#555" }}>7:05 PM CT</span>
                <span style={{ background: "rgba(0,255,135,0.1)", color: "#00FF87", fontSize: 10, fontWeight: 800, padding: "2px 8px", borderRadius: 5, letterSpacing: 1 }}>
                  {verdictLabel[freePick.filter?.verdict] || "🔥 Value Pick"}
                </span>
              </div>
              <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                <div style={{ flex: 1, background: "linear-gradient(155deg, #1c202a, #14161c)", border: "1px solid #242832", borderRadius: 8, padding: "8px 10px" }}>
                  <div style={{ fontSize: 9, color: "#555", marginBottom: 3 }}>AWAY</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: freePick.pick === freePick.awayTeam ? "#00FF87" : "#fff" }}>
                    {freePick.awayTeam?.split(" ").pop()}
                  </div>
                  <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: "#555", marginTop: 2 }}>
                    {freePick.awayOdds != null ? fmtOdds(freePick.awayOdds) : "—"}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", fontSize: 10, color: "#2b2f3a" }}>@</div>
                <div style={{ flex: 1, background: "linear-gradient(155deg, #1c202a, #14161c)", border: "1px solid #242832", borderRadius: 8, padding: "8px 10px", textAlign: "right" }}>
                  <div style={{ fontSize: 9, color: "#555", marginBottom: 3 }}>HOME</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: freePick.pick === freePick.homeTeam ? "#00FF87" : "#fff" }}>
                    {freePick.homeTeam?.split(" ").pop()}
                  </div>
                  <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: "#555", marginTop: 2 }}>
                    {freePick.homeOdds != null ? fmtOdds(freePick.homeOdds) : "—"}
                  </div>
                </div>
              </div>
              <div style={{ background: "rgba(0,255,135,0.06)", border: "1px solid rgba(0,255,135,0.1)", borderRadius: 8, padding: "8px 10px" }}>
                <div style={{ fontSize: 10, color: "#00FF87", fontWeight: 700, marginBottom: 3 }}>
                  Take {freePick.pick?.split(" ").pop()} · {freePick.edge?.toFixed(1)}% edge
                </div>
                {freePick.breakdown?.preview && (
                  <div style={{ fontSize: 10, color: "#555", lineHeight: 1.5 }}>
                    {freePick.breakdown.preview.slice(0, 90)}…
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Mock picks — some blurred */}
          {MOCK_PICKS.filter((_, i) => !freePick || i > 0).slice(0, 4).map((p, i) => (
            <div key={i} className={`pick-card blur-card`} style={{ marginBottom: 8, opacity: p.blur ? 0.7 : 1 }}>
              {p.blur && (
                <div className="blur-mask">
                  <div className="lock-badge">🔒 PRO ONLY</div>
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <span style={{ fontSize: 10, color: "#444" }}>MLB</span>
                {!p.blur && p.verdict && (
                  <span style={{ background: `rgba(${p.verdict === "CLEAN" ? "0,255,135" : "255,214,0"},0.1)`, color: verdictColor[p.verdict], fontSize: 9, fontWeight: 800, padding: "2px 7px", borderRadius: 5, letterSpacing: 1 }}>
                    {verdictLabel[p.verdict]}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, filter: p.blur ? "blur(6px)" : "none" }}>{p.away} @ {p.home}</div>
              {!p.blur && (
                <div style={{ fontSize: 10, color: "#00FF87", marginTop: 4 }}>Take {p.pick} {p.odds} · {p.edge}</div>
              )}
              {p.blur && (
                <div style={{ display: "flex", gap: 6, marginTop: 6, filter: "blur(5px)" }}>
                  <div className="shimmer-line" style={{ height: 8, width: "60%" }} />
                  <div className="shimmer-line" style={{ height: 8, width: "30%" }} />
                </div>
              )}
            </div>
          ))}

          {/* Bottom CTA inside mockup */}
          <div style={{ marginTop: 12, background: "rgba(0,255,135,0.06)", border: "1px solid rgba(0,255,135,0.12)", borderRadius: 12, padding: "12px", textAlign: "center" }}>
            <div style={{ fontSize: 11, color: "#00FF87", fontWeight: 700, marginBottom: 4 }}>Unlock all picks for $2/mo</div>
            <div style={{ fontSize: 10, color: "#444" }}>Full breakdowns · edge scores · parlay builder</div>
          </div>
        </div>
      </section>

      <div className="glow-line" style={{ maxWidth: 900, margin: "0 auto" }} />

      {/* ─── HOW IT WORKS ─────────────────────────────── */}
      <section style={{ padding: "80px 24px", maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 52 }}>
          <div style={{ fontSize: 11, color: "#00FF87", fontWeight: 700, letterSpacing: 2, marginBottom: 10 }}>HOW IT WORKS</div>
          <h2 style={{ fontSize: "clamp(26px,5vw,40px)", fontWeight: 800, letterSpacing: -1 }}>
            Built different from the jump
          </h2>
          <p style={{ color: "#555", fontSize: 15, marginTop: 12, maxWidth: 480, margin: "12px auto 0" }}>
            Most pick sites use vibes. We use a six-layer quantitative filter that needs every condition to pass.
          </p>
        </div>

        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          {[
            {
              icon: "⚾",
              title: "Pitcher-first analysis",
              body: "Starting pitcher ERA, WHIP, innings pitched, and sample size. Plus bullpen ERA, WHIP, and K/9 for the full game picture. Starters get the spotlight; bullpens finish ~40% of outs.",
              tag: "DATA LAYER 1",
            },
            {
              icon: "📐",
              title: "Market edge scoring",
              body: "We compare our model's win probability to the book's implied probability. Only plays with a verified edge above 2.5% after market calibration pass. No phantom edges.",
              tag: "DATA LAYER 2",
            },
            {
              icon: "🏟️",
              title: "Park + lineup context",
              body: "Coors isn't Petco. Every pick accounts for park factor, the lineup's OPS vs pitcher hand, and recent form over the last 10 games.",
              tag: "DATA LAYER 3",
            },
            {
              icon: "⚡",
              title: "CLEAN / BET / PASS tiers",
              body: "CLEAN picks pass every single condition in the AND-gate. BET passes most. PASS is transparent — the model's honest answer when there's no edge. Some days are zero-bet days and that's correct.",
              tag: "VERDICT SYSTEM",
            },
            {
              icon: "📊",
              title: "Personal tracker + P&L",
              body: "Every pick you save tracks wins, losses, and ties automatically. Real-time P&L in dollars based on your unit size. See your actual edge over time.",
              tag: "TRACKER",
            },
            {
              icon: "🤖",
              title: "Claude AI breakdowns",
              body: "Every pick comes with a 2-sentence preview, key deciding factor, main risk, and honest lean from Claude claude-sonnet-4-6 — the same reasoning layer that powers the pick.",
              tag: "AI LAYER",
            },
          ].map(({ icon, title, body, tag }) => (
            <div key={title} className="feature-card" style={{ minWidth: "calc(33% - 12px)", flex: "1 1 280px" }}>
              <div style={{ fontSize: 11, color: "#00FF87", fontWeight: 700, letterSpacing: 1.5, marginBottom: 12 }}>{tag}</div>
              <div style={{ fontSize: 22, marginBottom: 10 }}>{icon}</div>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>{title}</div>
              <div style={{ fontSize: 13, color: "#555", lineHeight: 1.65 }}>{body}</div>
            </div>
          ))}
        </div>
      </section>

      <div className="glow-line" style={{ maxWidth: 900, margin: "0 auto" }} />

      {/* ─── US VS VEGAS ──────────────────────────────── */}
      <section style={{ padding: "80px 24px", maxWidth: 900, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 52 }}>
          <div style={{ fontSize: 11, color: "#00FF87", fontWeight: 700, letterSpacing: 2, marginBottom: 10 }}>THE NUMBERS</div>
          <h2 style={{ fontSize: "clamp(26px,5vw,42px)", fontWeight: 800, letterSpacing: -1.5, lineHeight: 1.1 }}>
            Us <span style={{ color: "#00FF87" }}>{'>'}</span> Vegas
          </h2>
          <p style={{ color: "#555", fontSize: 15, marginTop: 14, maxWidth: 500, margin: "14px auto 0" }}>
            The book's built-in juice means you need to hit 52.4% just to break even. We aim higher.
          </p>
        </div>

        {/* Big comparison grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14, marginBottom: 40 }}>
          {[
            { label: "Break-even needed",    us: record?.pct ? `${record.pct}%`  : "—", them: "52.4%", usBetter: true,  sub: "win rate" },
            { label: "Model edge per pick",  us: record?.avgEdge ? `+${record.avgEdge}%` : "+3–5%",  them: "0%",     usBetter: true,  sub: "vs vig" },
            { label: "CLEAN picks screened", us: "6-layer",  them: "1-layer",   usBetter: true,  sub: "AND-gate filter" },
            { label: "Transparency",         us: "Full",     them: "None",       usBetter: true,  sub: "every condition shown" },
          ].map(({ label, us, them, usBetter, sub }) => (
            <div key={label} className="stat-card">
              <div style={{ fontSize: 11, color: "#444", letterSpacing: 1, marginBottom: 12 }}>{label.toUpperCase()}</div>
              <div style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 10, color: "#00FF87", fontWeight: 700, letterSpacing: 1, marginBottom: 3 }}>T|T</div>
                  <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 20, fontWeight: 700, color: "#00FF87" }}>{us}</div>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 10, color: "#444", fontWeight: 700, letterSpacing: 1, marginBottom: 3 }}>VEGAS</div>
                  <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 20, fontWeight: 700, color: "#3d424f" }}>{them}</div>
                </div>
              </div>
              <div style={{ fontSize: 11, color: "#3d424f", marginTop: 8 }}>{sub}</div>
            </div>
          ))}
        </div>

        {/* Disclaimer */}
        <div style={{ textAlign: "center", background: "linear-gradient(155deg,#17191f,#101216)", border: "1px solid #242832", boxShadow: "0 4px 18px rgba(0,0,0,0.3)", borderRadius: 12, padding: "16px 20px" }}>
          <div style={{ fontSize: 12, color: "#3d424f", lineHeight: 1.6 }}>
            MLB carries extreme variance. Even 60% pickers lose stretches. This is a tool for finding edges, not a guarantee. Bet responsibly.
          </div>
        </div>
      </section>

      <div className="glow-line" style={{ maxWidth: 900, margin: "0 auto" }} />

      {/* ─── SOCIAL PROOF ─────────────────────────────── */}
      <section style={{ padding: "80px 24px", maxWidth: 900, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 48 }}>
          <div style={{ fontSize: 11, color: "#00FF87", fontWeight: 700, letterSpacing: 2, marginBottom: 10 }}>WHAT PEOPLE SAY</div>
          <h2 style={{ fontSize: "clamp(24px,4vw,36px)", fontWeight: 800, letterSpacing: -1 }}>
            Real users. Real results.
          </h2>
        </div>

        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          {[
            {
              quote: "I've tried every pick site. T|T is the only one that actually explains WHY. The CLEAN filter is legit — when it fires I pay attention.",
              name: "Ryan M.",
              tag: "Pro member · 3 weeks",
            },
            {
              quote: "Hit 4 of 5 CLEAN picks last week. The breakdowns are insane — it told me exactly what to watch and it played out. Not giving this up.",
              name: "Darius T.",
              tag: "Pro member · baseball bettor",
            },
            {
              quote: "Free pick alone is worth it. CLEAN + edge data on one game every morning for free? Already 2-0 this week just off the free pick.",
              name: "Mike K.",
              tag: "Free tier",
            },
          ].map(({ quote, name, tag }) => (
            <div key={name} className="testimonial" style={{ flex: "1 1 240px" }}>
              <div style={{ fontSize: 28, color: "#00FF87", marginBottom: 12, lineHeight: 1 }}>"</div>
              <div style={{ fontSize: 14, color: "#888", lineHeight: 1.7, marginBottom: 16 }}>{quote}</div>
              <div style={{ borderTop: "1px solid #111", paddingTop: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{name}</div>
                <div style={{ fontSize: 11, color: "#444", marginTop: 2 }}>{tag}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="glow-line" style={{ maxWidth: 900, margin: "0 auto" }} />

      {/* ─── PRICING + BOTTOM CTA ─────────────────────── */}
      <section style={{ padding: "80px 24px", maxWidth: 860, margin: "0 auto", textAlign: "center" }}>
        <div style={{ fontSize: 11, color: "#00FF87", fontWeight: 700, letterSpacing: 2, marginBottom: 14 }}>PRICING</div>
        <h2 style={{ fontSize: "clamp(28px,5vw,44px)", fontWeight: 800, letterSpacing: -1.5, lineHeight: 1.1, marginBottom: 16 }}>
          Sharp picks shouldn't<br/>cost sharp money.
        </h2>
        <p style={{ color: "#555", fontSize: 15, marginBottom: 44 }}>Start free. Go pro when you're ready.</p>

        <div style={{ display: "flex", gap: 16, justifyContent: "center", flexWrap: "wrap", marginBottom: 48 }}>
          {/* Free */}
          <div style={{ background: "linear-gradient(155deg,#17191f,#101216)", border: "1px solid #242832", boxShadow: "0 4px 18px rgba(0,0,0,0.3)", borderRadius: 20, padding: "28px 28px", flex: "1 1 220px", maxWidth: 280, textAlign: "left" }}>
            <div style={{ fontSize: 13, color: "#555", fontWeight: 700, marginBottom: 10, letterSpacing: 1 }}>FREE</div>
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 36, fontWeight: 700, marginBottom: 4 }}>$0</div>
            <div style={{ fontSize: 12, color: "#444", marginBottom: 24 }}>forever</div>
            {["1 free pick daily", "Email digest every morning", "Model record public stats"].map(f => (
              <div key={f} style={{ display: "flex", gap: 8, alignItems: "center", padding: "7px 0", borderBottom: "1px solid #1c1f26", fontSize: 13, color: "#666" }}>
                <span style={{ color: "#3d424f", fontSize: 14 }}>✓</span> {f}
              </div>
            ))}
            <a href="/" className="ghost-btn" style={{ marginTop: 20, width: "100%", display: "block", textAlign: "center", fontSize: 13, padding: "12px" }}>Get started free</a>
          </div>

          {/* Pro */}
          <div style={{ background: "rgba(0,255,135,0.04)", border: "1px solid rgba(0,255,135,0.2)", borderRadius: 20, padding: "28px 28px", flex: "1 1 220px", maxWidth: 280, textAlign: "left", position: "relative" }}>
            <div style={{ position: "absolute", top: -13, left: "50%", transform: "translateX(-50%)", background: "#00FF87", color: "#000", fontSize: 10, fontWeight: 800, padding: "4px 14px", borderRadius: 20, letterSpacing: 1, whiteSpace: "nowrap" }}>MOST POPULAR</div>
            <div style={{ fontSize: 13, color: "#00FF87", fontWeight: 700, marginBottom: 10, letterSpacing: 1 }}>PRO MONTHLY</div>
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 36, fontWeight: 700, marginBottom: 4, color: "#00FF87" }}>$2</div>
            <div style={{ fontSize: 12, color: "#555", marginBottom: 24 }}>per month</div>
            {["All picks + full breakdowns", "Edge scores + variance data", "CLEAN / BET / PASS filter", "Parlay builder (CLEAN only)", "Personal tracker + P&L", "Access on all devices"].map(f => (
              <div key={f} style={{ display: "flex", gap: 8, alignItems: "center", padding: "7px 0", borderBottom: "1px solid rgba(0,255,135,0.06)", fontSize: 13, color: "#888" }}>
                <span style={{ color: "#00FF87", fontSize: 14 }}>✓</span> {f}
              </div>
            ))}
            <a href="/" className="cta-btn" style={{ marginTop: 20, width: "100%", display: "block", textAlign: "center" }}>Start for $2/mo →</a>
          </div>

          {/* Annual */}
          <div style={{ background: "linear-gradient(155deg,#17191f,#101216)", border: "1px solid #242832", boxShadow: "0 4px 18px rgba(0,0,0,0.3)", borderRadius: 20, padding: "28px 28px", flex: "1 1 220px", maxWidth: 280, textAlign: "left" }}>
            <div style={{ fontSize: 13, color: "#555", fontWeight: 700, marginBottom: 10, letterSpacing: 1 }}>PRO ANNUAL</div>
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 36, fontWeight: 700, marginBottom: 4 }}>$19.99</div>
            <div style={{ fontSize: 12, color: "#444", marginBottom: 24 }}>$1.67/mo · 2 months free</div>
            {["Everything in Pro Monthly", "Best value for the season", "Cancel anytime"].map(f => (
              <div key={f} style={{ display: "flex", gap: 8, alignItems: "center", padding: "7px 0", borderBottom: "1px solid #1c1f26", fontSize: 13, color: "#666" }}>
                <span style={{ color: "#3d424f", fontSize: 14 }}>✓</span> {f}
              </div>
            ))}
            <a href="/" className="ghost-btn" style={{ marginTop: 20, width: "100%", display: "block", textAlign: "center", fontSize: 13, padding: "12px" }}>Get annual →</a>
          </div>
        </div>

        {/* Divider */}
        <div className="glow-line" style={{ marginBottom: 60 }} />

        {/* Email capture */}
        <div ref={heroEmailRef} style={{ maxWidth: 440, margin: "0 auto" }}>
          <h3 style={{ fontSize: 24, fontWeight: 800, letterSpacing: -0.5, marginBottom: 8 }}>Not ready to pay?</h3>
          <p style={{ color: "#555", fontSize: 14, marginBottom: 24, lineHeight: 1.6 }}>
            Get one sharp pick every morning — free. No account needed. Unsubscribe any time.
          </p>

          {subStatus === "ok" ? (
            <div style={{ background: "rgba(0,255,135,0.08)", border: "1px solid rgba(0,255,135,0.2)", borderRadius: 14, padding: "20px", textAlign: "center" }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#00FF87" }}>You're in. ✓</div>
              <div style={{ fontSize: 13, color: "#555", marginTop: 6 }}>First pick lands tomorrow morning.</div>
            </div>
          ) : (
            <form onSubmit={subscribe} style={{ display: "flex", gap: 10 }}>
              <input
                type="email"
                placeholder="your@email.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                style={{ flex: 1, background: "linear-gradient(160deg, #14161c, #0d0e12)", border: "1px solid #242832", borderRadius: 12, padding: "14px 16px", color: "#fff", fontSize: 14, outline: "none" }}
              />
              <button type="submit" disabled={subStatus === "loading"} className="cta-btn" style={{ flexShrink: 0, fontSize: 14, padding: "14px 20px" }}>
                {subStatus === "loading" ? "…" : "Send me picks"}
              </button>
            </form>
          )}
          {subStatus === "err" && <div style={{ fontSize: 12, color: "#FF4D4D", marginTop: 8 }}>{errMsg}</div>}
        </div>
      </section>

      {/* ─── FOOTER ───────────────────────────────────── */}
      <footer style={{ borderTop: "1px solid #1c1f26", padding: "28px 24px", textAlign: "center" }}>
        <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 15, fontWeight: 700, marginBottom: 12 }}>
          T<span style={{ color: "#00FF87" }}>|</span>T
        </div>
        <div style={{ display: "flex", gap: 20, justifyContent: "center", flexWrap: "wrap", fontSize: 12, color: "#3d424f" }}>
          <a href="/" style={{ color: "#3d424f" }}>App</a>
          <a href="https://twitter.com/ThisorThatPicks" target="_blank" rel="noopener noreferrer" style={{ color: "#3d424f" }}>𝕏 @ThisorThatPicks</a>
          <a href="/privacy" style={{ color: "#3d424f" }}>Privacy</a>
          <a href="/terms" style={{ color: "#3d424f" }}>Terms</a>
        </div>
        <div style={{ fontSize: 11, color: "#242832", marginTop: 16 }}>
          For entertainment purposes. Bet responsibly.
        </div>
      </footer>
    </div>
  );
}
