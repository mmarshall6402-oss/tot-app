"use client";

// Shared NFL UI — used by both app/page.js and app/app/page.js so future NFL UI
// changes (like the totals-market rendering added here) only need to happen once.
// Previously these were two independently-maintained copies that had already
// drifted (app/page.js had Fantasy/Picks/Record subtabs behind an odds-only teaser;
// app/app/page.js had a single Pro-gated real-picks view with no Fantasy/Record at
// all). This merges them: Fantasy and Record are available everywhere (their APIs
// aren't Pro-gated), and the Picks subtab shows real BET/PASS/TRAP/total cards for
// Pro users or an odds-only teaser + upgrade CTA otherwise.
//
// Host pages must pass their own `S` style-token object (card, cardTop, badge,
// center, spinner, saveBtn, expandBtn, pitchRow, pitchBox, pitchLabel, pitchName,
// pitchVs, expDivider, expSection, sortBtn) rather than this component guessing at
// values that could silently drift from the host's actual theme.

import { useState, useEffect } from "react";

const NFL_ORANGE = "#FF6B35";

const fmtOdds = (o) => o == null ? "—" : (o > 0 ? `+${o}` : `${o}`);
function fmtGameTime(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
function fmtDateLabel(dateStr) {
  if (!dateStr) return "";
  const d = new Date(`${dateStr}T12:00:00`);
  return d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
}
const TIER = {
  High:   { color: "#00FF87", bg: "rgba(0,255,135,0.08)", label: "🔥 Value Pick" },
  Medium: { color: "#FFD600", bg: "rgba(255,214,0,0.08)",  label: "✅ Solid Pick" },
  Low:    { color: "#888",    bg: "rgba(136,136,136,0.08)", label: "👀 Lean" },
};

export default function NFLSection({ S, getAuthHeaders, isPro, isAdmin, setUpgradeModal, savePick, saving, selectedDate }) {
  const [subTab, setSubTab] = useState("fantasy");
  const [scoring, setScoring] = useState("PPR");
  const [fantasyMode, setFantasyMode] = useState("startSit");

  // Start/Sit state
  const [playerA, setPlayerA] = useState("");
  const [playerB, setPlayerB] = useState("");
  const [ssResult, setSsResult] = useState(null);
  const [ssLoading, setSsLoading] = useState(false);

  // Trade state
  const [tradeGive, setTradeGive] = useState("");
  const [tradeGet, setTradeGet] = useState("");
  const [tradeResult, setTradeResult] = useState(null);
  const [tradeLoading, setTradeLoading] = useState(false);

  // Ask AI state
  const [askQ, setAskQ] = useState("");
  const [askResult, setAskResult] = useState(null);
  const [askLoading, setAskLoading] = useState(false);

  // Odds teaser state (non-Pro Picks view)
  const [nflGames, setNflGames] = useState(null);
  const [nflLoading, setNflLoading] = useState(false);
  const [nflMsg, setNflMsg] = useState(null);

  // Real picks state (Pro Picks view)
  const [nflPicks, setNflPicks] = useState(null);
  const [nflPicksError, setNflPicksError] = useState(null);
  const [nflPicksLoading, setNflPicksLoading] = useState(false);
  const [nflExpanded, setNflExpanded] = useState(null);
  const [nflGenerating, setNflGenerating] = useState(false);

  // Record state
  const [nflRecord, setNflRecord] = useState(null);
  const [nflRecordLoading, setNflRecordLoading] = useState(false);

  const callFantasy = async (mode, body) => {
    const headers = await getAuthHeaders();
    const res = await fetch("/api/nfl/fantasy", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ mode, scoring, ...body }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Error");
    return data.result;
  };

  const runStartSit = async () => {
    if (!playerA.trim() || !playerB.trim()) return;
    setSsLoading(true); setSsResult(null);
    try { setSsResult(await callFantasy("startSit", { playerA: playerA.trim(), playerB: playerB.trim() })); }
    catch (e) { setSsResult("Error: " + e.message); }
    setSsLoading(false);
  };

  const runTrade = async () => {
    if (!tradeGive.trim() || !tradeGet.trim()) return;
    setTradeLoading(true); setTradeResult(null);
    try { setTradeResult(await callFantasy("trade", { tradeGive: tradeGive.trim(), tradeGet: tradeGet.trim() })); }
    catch (e) { setTradeResult("Error: " + e.message); }
    setTradeLoading(false);
  };

  const runAsk = async () => {
    if (!askQ.trim()) return;
    setAskLoading(true); setAskResult(null);
    try { setAskResult(await callFantasy("ask", { question: askQ.trim() })); }
    catch (e) { setAskResult("Error: " + e.message); }
    setAskLoading(false);
  };

  const loadOdds = async () => {
    setNflLoading(true); setNflGames(null); setNflMsg(null);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch("/api/nfl/odds", { headers });
      const data = await res.json();
      setNflGames(data.games || []);
      if (data.message) setNflMsg(data.message);
    } catch (e) { setNflMsg("Failed to load odds"); setNflGames([]); }
    setNflLoading(false);
  };

  const loadRecord = async () => {
    setNflRecordLoading(true);
    try {
      const res = await fetch("/api/nfl/daily-record");
      const data = await res.json();
      setNflRecord(!data.error ? data : {});
    } catch (e) { setNflRecord({}); }
    setNflRecordLoading(false);
  };

  useEffect(() => {
    if (subTab === "record" && nflRecord === null && !nflRecordLoading) loadRecord();
  }, [subTab, nflRecord, nflRecordLoading]);

  const fetchNflPicks = async (date, bust = false) => {
    setNflPicksLoading(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/nfl/picks?date=${date}${bust ? "&bust=1" : ""}`, { headers });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
      setNflPicksError(null);
      setNflPicks(data.picks || []);
    } catch (e) {
      console.error("nfl picks error", e);
      setNflPicksError(e.message || "Could not load games");
      setNflPicks(prev => prev ?? []);
    }
    setNflPicksLoading(false);
  };

  const generateNflPicks = async () => {
    setNflGenerating(true);
    try {
      const headers = await getAuthHeaders();
      await fetch("/api/admin/regen", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify({ sport: "nfl", date: selectedDate }) });
      await fetchNflPicks(selectedDate, true);
    } catch (e) { console.error("nfl regen error", e); }
    setNflGenerating(false);
  };

  useEffect(() => {
    if (subTab === "picks" && isPro && nflPicks === null && !nflPicksLoading) fetchNflPicks(selectedDate);
  }, [subTab, isPro, selectedDate, nflPicks, nflPicksLoading]);

  const inputStyle = {
    background: "#0a0a0a", border: "1px solid #222", borderRadius: 10,
    padding: "11px 14px", color: "#fff", fontSize: 14, outline: "none", width: "100%",
  };
  const orangeBtn = (disabled) => ({
    background: disabled ? "#1a1a1a" : NFL_ORANGE, color: disabled ? "#444" : "#000",
    border: "none", borderRadius: 10, padding: "12px 0", fontWeight: 800,
    fontSize: 14, width: "100%", cursor: disabled ? "default" : "pointer",
    transition: "all 0.15s",
  });

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>

      {/* Sub-nav */}
      <div style={{ display: "flex", gap: 6, padding: "10px 20px", borderBottom: "1px solid #1a1a1a", overflowX: "auto" }}>
        {[
          { id: "fantasy", label: "⚡ Fantasy" },
          { id: "picks",   label: "🏈 Picks" },
          { id: "record",  label: "📅 Record" },
        ].map(({ id, label }) => (
          <button key={id}
            style={{
              flexShrink: 0, padding: "6px 16px", borderRadius: 20, fontSize: 12, fontWeight: 600,
              background: subTab === id ? "rgba(255,107,53,0.1)" : "#111",
              border: `1px solid ${subTab === id ? NFL_ORANGE : "#333"}`,
              color: subTab === id ? NFL_ORANGE : "#999", letterSpacing: 0.3,
            }}
            onClick={() => setSubTab(id)}>
            {label}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, padding: "16px 20px 40px", display: "flex", flexDirection: "column", gap: 14 }}>

        {/* Scoring format */}
        {(subTab === "fantasy") && (
          <div style={{ display: "flex", gap: 6 }}>
            {["PPR", "Half-PPR", "Standard"].map(fmt => (
              <button key={fmt} onClick={() => setScoring(fmt)} style={{
                flex: 1, padding: "8px 6px", borderRadius: 10, fontSize: 11, fontWeight: 700,
                border: `1px solid ${scoring === fmt ? NFL_ORANGE : "#1a1a1a"}`,
                background: scoring === fmt ? "rgba(255,107,53,0.08)" : "#0d0d0d",
                color: scoring === fmt ? NFL_ORANGE : "#444",
              }}>{fmt}</button>
            ))}
          </div>
        )}

        {/* ── FANTASY TAB ── */}
        {subTab === "fantasy" && (
          <>
            {/* Mode selector */}
            <div style={{ display: "flex", gap: 6 }}>
              {[
                { id: "startSit", label: "Start/Sit" },
                { id: "trade",    label: "Trade" },
                { id: "ask",      label: "Ask AI" },
              ].map(({ id, label }) => (
                <button key={id} onClick={() => setFantasyMode(id)} style={{
                  flex: 1, padding: "10px 6px", borderRadius: 10, fontSize: 13, fontWeight: 700,
                  border: `1px solid ${fantasyMode === id ? NFL_ORANGE : "#222"}`,
                  background: fantasyMode === id ? "rgba(255,107,53,0.1)" : "#0d0d0d",
                  color: fantasyMode === id ? NFL_ORANGE : "#555",
                }}>{label}</button>
              ))}
            </div>

            {fantasyMode === "startSit" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input style={inputStyle} placeholder="Player A (e.g. Justin Jefferson)" value={playerA}
                    onChange={e => setPlayerA(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && runStartSit()} />
                  <span style={{ color: "#444", fontWeight: 700, flexShrink: 0 }}>vs</span>
                  <input style={inputStyle} placeholder="Player B (e.g. CeeDee Lamb)" value={playerB}
                    onChange={e => setPlayerB(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && runStartSit()} />
                </div>
                <button style={orangeBtn(!playerA.trim() || !playerB.trim() || ssLoading)}
                  disabled={!playerA.trim() || !playerB.trim() || ssLoading}
                  onClick={runStartSit}>
                  {ssLoading ? "Analyzing…" : "Get verdict →"}
                </button>
                {ssResult && (
                  <div style={{ background: "#0d0d0d", border: `1px solid rgba(255,107,53,0.25)`, borderRadius: 14, padding: 16 }}>
                    <div style={{ fontSize: 10, color: NFL_ORANGE, fontWeight: 700, letterSpacing: 1.5, marginBottom: 8 }}>START / SIT · {scoring}</div>
                    <div style={{ fontSize: 13, color: "#ccc", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{ssResult}</div>
                  </div>
                )}
              </div>
            )}

            {fantasyMode === "trade" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div>
                  <div style={{ fontSize: 11, color: "#555", marginBottom: 6, letterSpacing: 0.5 }}>I'M GIVING</div>
                  <input style={inputStyle} placeholder="e.g. Saquon Barkley + WR2" value={tradeGive}
                    onChange={e => setTradeGive(e.target.value)} />
                </div>
                <div>
                  <div style={{ fontSize: 11, color: "#555", marginBottom: 6, letterSpacing: 0.5 }}>I'M GETTING</div>
                  <input style={inputStyle} placeholder="e.g. Tyreek Hill" value={tradeGet}
                    onChange={e => setTradeGet(e.target.value)} />
                </div>
                <button style={orangeBtn(!tradeGive.trim() || !tradeGet.trim() || tradeLoading)}
                  disabled={!tradeGive.trim() || !tradeGet.trim() || tradeLoading}
                  onClick={runTrade}>
                  {tradeLoading ? "Analyzing…" : "Analyze trade →"}
                </button>
                {tradeResult && (
                  <div style={{ background: "#0d0d0d", border: `1px solid rgba(255,107,53,0.25)`, borderRadius: 14, padding: 16 }}>
                    <div style={{ fontSize: 10, color: NFL_ORANGE, fontWeight: 700, letterSpacing: 1.5, marginBottom: 8 }}>TRADE ANALYSIS · {scoring}</div>
                    <div style={{ fontSize: 13, color: "#ccc", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{tradeResult}</div>
                  </div>
                )}
              </div>
            )}

            {fantasyMode === "ask" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <textarea style={{ ...inputStyle, minHeight: 80, resize: "vertical", fontFamily: "inherit" }}
                  placeholder="e.g. Who should I stream at flex this week? My WR1 is out."
                  value={askQ} onChange={e => setAskQ(e.target.value)} />
                <button style={orangeBtn(!askQ.trim() || askLoading)}
                  disabled={!askQ.trim() || askLoading}
                  onClick={runAsk}>
                  {askLoading ? "Thinking…" : "Ask →"}
                </button>
                {askResult && (
                  <div style={{ background: "#0d0d0d", border: `1px solid rgba(255,107,53,0.25)`, borderRadius: 14, padding: 16 }}>
                    <div style={{ fontSize: 10, color: NFL_ORANGE, fontWeight: 700, letterSpacing: 1.5, marginBottom: 8 }}>AI VERDICT · {scoring}</div>
                    <div style={{ fontSize: 13, color: "#ccc", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{askResult}</div>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* ── PICKS TAB — non-Pro: odds teaser ── */}
        {subTab === "picks" && !isPro && (
          <>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 7, background: "rgba(255,107,53,0.06)", border: "1px solid rgba(255,107,53,0.2)", borderRadius: 30, padding: "4px 12px", alignSelf: "flex-start" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: NFL_ORANGE, display: "inline-block", animation: "pulse 1.5s ease-in-out infinite" }} />
              <span style={{ fontSize: 10, color: NFL_ORANGE, fontWeight: 700, letterSpacing: 1.5 }}>LIVE ODDS · NFL</span>
            </div>

            {nflGames === null && !nflLoading && (
              <button style={orangeBtn(false)} onClick={loadOdds}>Load NFL odds →</button>
            )}
            {nflLoading && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#555", fontSize: 13 }}>
                <div style={{ width: 18, height: 18, border: "2px solid #222", borderTopColor: NFL_ORANGE, borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
                Loading odds…
              </div>
            )}
            {nflMsg && <div style={{ fontSize: 12, color: "#555", textAlign: "center" }}>{nflMsg}</div>}
            {nflGames !== null && nflGames.length === 0 && !nflMsg && (
              <div style={{ background: "#0d0d0d", border: "1px solid #1a1a1a", borderRadius: 14, padding: "28px 16px", textAlign: "center" }}>
                <div style={{ fontSize: 28, marginBottom: 10 }}>🏈</div>
                <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>No games on the board</div>
                <div style={{ fontSize: 13, color: "#555", lineHeight: 1.6 }}>NFL odds will appear here during preseason and the regular season. Check back in August.</div>
              </div>
            )}
            {nflGames?.map(g => (
              <div key={g.id} style={{ background: "#0d0d0d", border: "1px solid #1a1a1a", borderRadius: 14, padding: 16, animation: "fadeUp 0.3s ease" }}>
                <div style={{ fontSize: 11, color: "#555", marginBottom: 8 }}>{fmtGameTime(g.commenceTime)}</div>
                <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 15, fontWeight: 700, marginBottom: 12 }}>
                  {g.awayTeam} @ {g.homeTeam}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                  {[
                    { label: "ML", away: fmtOdds(g.awayOdds), home: fmtOdds(g.homeOdds) },
                    { label: `SPREAD (${g.spread > 0 ? "+" : ""}${g.spread ?? "—"})`, away: fmtOdds(g.awaySpreadOdds), home: fmtOdds(g.homeSpreadOdds) },
                    { label: `TOTAL (${g.total ?? "—"})`, away: `O ${fmtOdds(g.overOdds)}`, home: `U ${fmtOdds(g.underOdds)}` },
                  ].map(({ label, away, home }) => (
                    <div key={label} style={{ background: "#080808", border: "1px solid #1a1a1a", borderRadius: 10, padding: "10px 10px" }}>
                      <div style={{ fontSize: 9, color: "#444", fontWeight: 700, letterSpacing: 1, marginBottom: 6 }}>{label}</div>
                      <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, color: "#888", marginBottom: 2 }}>{away}</div>
                      <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, color: "#888" }}>{home}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {nflGames !== null && nflGames.length > 0 && (
              <button style={{ ...orangeBtn(false), marginTop: 4 }} onClick={loadOdds}>↺ Refresh</button>
            )}
            <div style={{ background: "#080808", border: "1px solid #1a1a1a", borderRadius: 14, padding: "16px" }}>
              <div style={{ fontSize: 10, color: NFL_ORANGE, fontWeight: 700, letterSpacing: 2, marginBottom: 8 }}>MODEL PICKS</div>
              <div style={{ fontSize: 13, color: "#555", lineHeight: 1.6 }}>
                Spread, moneyline, and total picks with BET/PASS/TRAP verdicts are live now — generated weekly by the same model pipeline as MLB.
              </div>
              <button style={{ ...S.saveBtn, marginTop: 12, background: "#00FF87", color: "#000", borderColor: "#00FF87" }} onClick={() => setUpgradeModal(true)}>⚡ Upgrade to Pro</button>
            </div>
          </>
        )}

        {/* ── PICKS TAB — Pro: real model picks ── */}
        {subTab === "picks" && isPro && (
          nflPicks === null ? (
            <div style={S.center}>
              <div style={S.spinner} />
              <div style={{ color: "#777", fontSize: 13, marginTop: 12 }}>Analyzing {fmtDateLabel(selectedDate)}'s games…</div>
            </div>
          ) : nflPicksError ? (
            <div style={S.center}>
              <div style={{ fontSize: 32 }}>⚠️</div>
              <div style={{ color: "#fff", fontWeight: 700, marginTop: 8 }}>Could not load games</div>
              <div style={{ color: "#777", fontSize: 13, marginTop: 4 }}>{nflPicksError}</div>
              <button style={{ ...S.saveBtn, marginTop: 14 }} onClick={() => fetchNflPicks(selectedDate, true)}>Retry</button>
            </div>
          ) : nflPicks.length === 0 ? (
            <div style={S.center}>
              <div style={{ fontSize: 32 }}>🏈</div>
              <div style={{ color: "#fff", fontWeight: 700, marginTop: 8 }}>No games found</div>
              <div style={{ color: "#777", fontSize: 13, marginTop: 4 }}>Try a different date</div>
            </div>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "6px 0", borderBottom: "1px solid #0d0d0d", marginBottom: 4 }}>
                <span style={{ fontSize: 11, color: "#777" }}>{nflPicks.length} picks</span>
                <span style={{ fontSize: 11, color: "#00FF87" }}>{nflPicks.filter(p => p.isBet).length} BET</span>
                <span style={{ fontSize: 11, color: "#555" }}>{nflPicks.filter(p => !p.isBet).length} PASS</span>
                <button style={{ ...S.sortBtn, marginLeft: "auto", fontSize: 13 }} onClick={() => fetchNflPicks(selectedDate, true)} title="Refresh picks">↺</button>
                {isAdmin && (
                  <button
                    style={{ ...S.sortBtn, fontSize: 11, background: nflGenerating ? "rgba(0,255,135,0.1)" : "#111", color: nflGenerating ? "#00FF87" : "#555", borderColor: nflGenerating ? "#00FF87" : "#333" }}
                    onClick={generateNflPicks}
                    disabled={nflGenerating}
                    title="Force-generate NFL picks for this date"
                  >{nflGenerating ? "…" : "⚡ Gen"}</button>
                )}
              </div>
              {nflPicks.map(pick => {
                const isBet = pick.isBet;
                const edge = pick.edge || 0;
                const t = TIER[pick.tier?.level] || TIER.Low;
                const isOpen = nflExpanded === pick.id;
                const f = pick.filter;
                const verdict = f?.verdict;
                const pickOdds = pick.marketType === "spread"
                  ? (pick.pick === pick.homeTeam ? pick.homeSpreadOdds : pick.awaySpreadOdds)
                  : pick.marketType === "total"
                  ? (pick.pick === "Over" ? pick.overOdds : pick.underOdds)
                  : (pick.pick === pick.homeTeam ? pick.homeOdds : pick.awayOdds);
                const spreadLine = pick.marketType === "spread" && pick.spread != null
                  ? (pick.pick === pick.homeTeam ? -pick.spread : pick.spread)
                  : null;
                const totalLine = pick.marketType === "total" && pick.total != null ? pick.total : null;
                const isNflSaved = saving[pick.id] === "saved";
                const cardBorder = isOpen ? (isBet ? "#00FF87" : "#2a2a2a") : (isBet ? "rgba(0,255,135,0.25)" : "#1a1a1a");

                return (
                  <div key={pick.id} style={{ ...S.card, borderColor: cardBorder }}>
                    <div style={S.cardTop}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                          <span style={{
                            fontSize: 11, fontWeight: 800, padding: "3px 10px", borderRadius: 6, letterSpacing: 1.5,
                            background: verdict === "TRAP" ? "rgba(255,77,77,0.1)" : isBet ? "rgba(0,255,135,0.08)" : "rgba(50,50,50,0.5)",
                            color: verdict === "TRAP" ? "#FF4D4D" : isBet ? "#00FF87" : "#333",
                            border: `1px solid ${verdict === "TRAP" ? "rgba(255,77,77,0.3)" : isBet ? "rgba(0,255,135,0.2)" : "#222"}`,
                          }}>
                            {verdict === "TRAP" ? "TRAP" : isBet ? "BET" : "PASS"}
                          </span>
                          <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 5, background: "#111", color: "#888", letterSpacing: 0.5 }}>
                            {pick.marketType === "spread" ? "SPREAD" : pick.marketType === "total" ? "TOTAL" : "MONEYLINE"}
                          </span>
                          {f && <span style={{ fontSize: 11, color: isBet ? "#555" : "#333", fontFamily: "'JetBrains Mono',monospace" }}>{edge.toFixed(1)}% edge</span>}
                          {isBet && <span style={{ fontSize: 10, color: t.color, opacity: 0.7 }}>{t.label}</span>}
                        </div>
                        <div style={S.cardMatchup}>{pick.awayTeam} @ {pick.homeTeam}</div>
                        <div style={S.cardMeta}>
                          {fmtGameTime(pick.commenceTime)}
                          {pick.pick && <> · Take{" "}
                            <span style={{ color: isBet ? "#00FF87" : "#aaa", fontWeight: 700 }}>
                              {pick.pick}
                              {spreadLine != null ? ` ${spreadLine > 0 ? "+" : ""}${spreadLine}` : ""}
                              {totalLine != null ? ` ${totalLine}` : ""}
                            </span>
                          </>}
                          {pickOdds != null && <span style={{ color: "#888", fontFamily: "'JetBrains Mono',monospace" }}> · {fmtOdds(pickOdds)}</span>}
                        </div>
                        <div style={{ marginTop: 7, display: "flex", alignItems: "center", gap: 7 }}>
                          <div style={{ flex: 1, height: 3, background: "#111", borderRadius: 2 }}>
                            <div style={{ height: "100%", borderRadius: 2, width: `${Math.min(100, edge * 6)}%`, background: isBet ? t.color : "#222", transition: "width 0.5s ease" }} />
                          </div>
                          {f && <span style={{ fontSize: 10, color: isBet ? t.color : "#333", fontFamily: "'JetBrains Mono',monospace", flexShrink: 0 }}>{edge.toFixed(1)}%</span>}
                        </div>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end", flexShrink: 0 }}>
                        <button
                          style={{ ...S.saveBtn, background: isNflSaved ? "#00FF87" : "transparent", color: isNflSaved ? "#000" : "#00FF87", borderColor: "#00FF87" }}
                          onClick={() => savePick(pick, "nfl")}
                        >
                          {isNflSaved ? "✓ Saved" : "+ Save"}
                        </button>
                        <button
                          style={{ ...S.expandBtn, borderColor: isOpen ? (isBet ? "#00FF87" : "#444") : "#222", color: isOpen ? (isBet ? "#00FF87" : "#444") : "#333" }}
                          onClick={() => setNflExpanded(isOpen ? null : pick.id)}
                        >
                          {isOpen ? "▲" : "▼"}
                        </button>
                      </div>
                    </div>
                    <div style={S.pitchRow}>
                      <div style={S.pitchBox}>
                        <div style={S.pitchLabel}>{pick.awayTeam?.toUpperCase()}</div>
                        <div style={S.pitchName}>{pick.matchup?.away || "stats unavailable"}</div>
                      </div>
                      <div style={S.pitchVs}>VS</div>
                      <div style={{ ...S.pitchBox, textAlign: "right" }}>
                        <div style={S.pitchLabel}>{pick.homeTeam?.toUpperCase()}</div>
                        <div style={S.pitchName}>{pick.matchup?.home || "stats unavailable"}</div>
                      </div>
                    </div>
                    {isOpen && f && (
                      <div style={{ animation: "fadeUp 0.2s ease" }}>
                        <div style={S.expDivider} />
                        <div style={S.expSection}>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#888", marginBottom: 4 }}>
                            <span>Confidence</span><span style={{ color: "#ccc", fontFamily: "'JetBrains Mono',monospace" }}>{f.confidence}/10</span>
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#888", marginBottom: 4 }}>
                            <span>Model win prob</span><span style={{ color: "#ccc", fontFamily: "'JetBrains Mono',monospace" }}>{f.trueWinProbPct}%</span>
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#888", marginBottom: 4 }}>
                            <span>Market implied</span><span style={{ color: "#ccc", fontFamily: "'JetBrains Mono',monospace" }}>{f.marketImpliedPct}%</span>
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#888", marginBottom: 4 }}>
                            <span>Uncertainty</span><span style={{ color: "#ccc", fontFamily: "'JetBrains Mono',monospace" }}>±{f.uncertaintyPct}%</span>
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#888" }}>
                            <span>Data variance</span><span style={{ color: "#ccc" }}>{f.variance}</span>
                          </div>
                          {f.failures?.length > 0 && (
                            <div style={{ marginTop: 8, fontSize: 11, color: "#666", lineHeight: 1.5 }}>
                              {f.failures.map((fail, i) => <div key={i}>· {fail}</div>)}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )
        )}

        {/* ── RECORD TAB ── */}
        {subTab === "record" && (
          <div style={{ background: "#080808", border: "1px solid rgba(255,107,53,0.2)", borderRadius: 16, padding: "20px 18px" }}>
            <div style={{ fontSize: 10, color: NFL_ORANGE, fontWeight: 700, letterSpacing: 2, marginBottom: 10 }}>NFL RECORD</div>
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 18, fontWeight: 700, marginBottom: 8, lineHeight: 1.2 }}>
              ATS record tracked<br/><span style={{ color: NFL_ORANGE }}>week by week.</span>
            </div>
            <div style={{ fontSize: 13, color: "#555", lineHeight: 1.65 }}>
              {nflRecordLoading ? "Loading…" : (nflRecord?.wins ?? 0) + (nflRecord?.losses ?? 0) > 0
                ? "Every settled BET-tier pick since the model went live, moneyline + spread + total combined."
                : "No settled picks yet — record fills in as this week's games finish."}
            </div>
            <div style={{ marginTop: 20, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              {[
                { label: "W-L Record", value: nflRecord ? `${nflRecord.wins ?? 0}-${nflRecord.losses ?? 0}` : null },
                { label: "ATS %",      value: nflRecord?.atsPct != null ? `${nflRecord.atsPct}%` : null },
                { label: "Units",      value: nflRecord?.units != null ? `${nflRecord.units >= 0 ? "+" : ""}${nflRecord.units}` : null },
              ].map(({ label, value }) => (
                <div key={label} style={{ background: "#0d0d0d", border: "1px solid #1a1a1a", borderRadius: 10, padding: "14px 10px", textAlign: "center" }}>
                  <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 18, fontWeight: 700, color: value != null ? "#fff" : "#222" }}>{value ?? "—"}</div>
                  <div style={{ fontSize: 10, color: "#333", marginTop: 4, letterSpacing: 1 }}>{label.toUpperCase()}</div>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
