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
import { impliedWinPct, oddsMovement } from "../lib/odds-display.js";
import { TeamMatchupLink } from "./TeamModal.js";
import { translateReasons } from "../lib/reason-labels.js";
import { shouldBetNow } from "../lib/fair-odds.js";
import { accentButtonStyle, tabButtonStyle, tokens, iconButtonStyle } from "../lib/ui-theme.js";
import { CheckIcon, RefreshIcon } from "./icons.js";

function pickOddsFor(pick) {
  if (pick.marketType === "spread") return pick.pick === pick.homeTeam ? pick.homeSpreadOdds : pick.awaySpreadOdds;
  if (pick.marketType === "total") return pick.pick === "Over" ? pick.overOdds : pick.underOdds;
  return pick.pick === pick.homeTeam ? pick.homeOdds : pick.awayOdds;
}

const NFL_ORANGE = "#D9754A";

// NFL picks have no openHomeOdds/openAwayOdds (no CLV tracking yet), so the
// movement arrow just never renders here — degrades gracefully, same component
// shape as the one duplicated in app/page.js and app/app/page.js for MLB.
function WinPctRow({ homeTeam, awayTeam, homeOdds, awayOdds, openHomeOdds, openAwayOdds }) {
  const wp = impliedWinPct(homeOdds, awayOdds);
  if (!wp) return null;
  const move = oddsMovement(openHomeOdds, homeOdds, openAwayOdds, awayOdds);
  const arrow = move?.direction === "up" ? "▲" : move?.direction === "down" ? "▼" : null;
  const arrowColor = move?.direction === "up" ? "#2FBF71" : move?.direction === "down" ? "#D9645C" : "#555";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 6, fontSize: 11, fontFamily: tokens.font.mono }}>
      <span style={{ color: "#666" }}>{(awayTeam || "").split(" ").pop()} <b style={{ color: "#bbb" }}>{wp.away}%</b></span>
      <span style={{ color: "#3d424f" }}>·</span>
      <span style={{ color: "#666" }}>{(homeTeam || "").split(" ").pop()} <b style={{ color: "#bbb" }}>{wp.home}%</b></span>
      {arrow && (
        <span style={{ color: arrowColor }}>{arrow} {move.delta}% since open</span>
      )}
    </div>
  );
}

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
  High:   { color: "#2FBF71", bg: "rgba(47,191,113,0.08)", label: "Value Pick" },
  Medium: { color: "#D6B23D", bg: "rgba(214,178,61,0.08)",  label: "Solid Pick" },
  Low:    { color: "#888",    bg: "rgba(136,136,136,0.08)", label: "Lean" },
};

// Maps computed draft-cheat-sheet tiers (1, 2, 3…) onto the same three-color
// language already used for betting-pick tiers, so the fantasy feature reads
// as the same visual system rather than introducing a new one.
function draftTierStyle(tier) {
  if (tier <= 2) return TIER.High;
  if (tier <= 4) return TIER.Medium;
  return TIER.Low;
}
function scoringToFormat(scoring) {
  if (scoring === "Half-PPR") return "half_ppr";
  if (scoring === "Standard") return "standard";
  return "ppr";
}

export default function NFLSection({ S, getAuthHeaders, isPro, isAdmin, setUpgradeModal, savePick, saving, selectedDate, onTeamClick }) {
  const [subTab, setSubTab] = useState("fantasy");
  const [scoring, setScoring] = useState("PPR");
  const [fantasyMode, setFantasyMode] = useState("startSit");

  // Start/Sit state
  const [playerA, setPlayerA] = useState("");
  const [playerB, setPlayerB] = useState("");
  const [ssResult, setSsResult] = useState(null);
  const [ssProbability, setSsProbability] = useState(null);
  const [ssLoading, setSsLoading] = useState(false);
  const [gutLogged, setGutLogged] = useState(null);
  const [gutLogging, setGutLogging] = useState(false);
  const [gutError, setGutError] = useState(null);

  // Gut vs Model record state
  const [gutRecord, setGutRecord] = useState(null);
  const [gutRecordLoading, setGutRecordLoading] = useState(false);

  // Trade state
  const [tradeGive, setTradeGive] = useState("");
  const [tradeGet, setTradeGet] = useState("");
  const [tradeResult, setTradeResult] = useState(null);
  const [tradeLoading, setTradeLoading] = useState(false);

  // Ask AI state
  const [askQ, setAskQ] = useState("");
  const [askResult, setAskResult] = useState(null);
  const [askLoading, setAskLoading] = useState(false);

  // Cheat Sheet state
  const [cheatSheet, setCheatSheet] = useState(null);
  const [cheatSheetLoading, setCheatSheetLoading] = useState(false);
  const [cheatSheetError, setCheatSheetError] = useState(null);
  const [positionFilter, setPositionFilter] = useState("ALL");

  // My Team (Sleeper connect + roster) state
  const [sleeperConnection, setSleeperConnection] = useState(null); // null = not yet loaded
  const [sleeperLoading, setSleeperLoading] = useState(false);
  const [sleeperError, setSleeperError] = useState(null);
  const [sleeperUsername, setSleeperUsername] = useState("");
  const [sleeperLookup, setSleeperLookup] = useState(null); // { sleeperUserId, username, leagues }
  const [sleeperBusy, setSleeperBusy] = useState(false);

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
    return data;
  };

  const runStartSit = async () => {
    if (!playerA.trim() || !playerB.trim()) return;
    setSsLoading(true); setSsResult(null); setSsProbability(null); setGutLogged(null); setGutError(null);
    try {
      const data = await callFantasy("startSit", { playerA: playerA.trim(), playerB: playerB.trim() });
      setSsResult(data.result);
      setSsProbability(data.probability || null);
    } catch (e) { setSsResult("Error: " + e.message); }
    setSsLoading(false);
  };

  // Records which player the user actually says they're starting, alongside
  // what the model favored at that moment (app/api/nfl/fantasy/gut-calls).
  // Only meaningful once a probability was returned — no model pick to
  // compare against otherwise.
  const logGutCall = async (pick) => {
    setGutLogging(true); setGutError(null);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch("/api/nfl/fantasy/gut-calls", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ playerA: playerA.trim(), playerB: playerB.trim(), gutPick: pick, scoring }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error");
      setGutLogged(data);
    } catch (e) {
      setGutError(e.message || "Could not log your pick");
    }
    setGutLogging(false);
  };

  const loadGutRecord = async () => {
    setGutRecordLoading(true);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch("/api/nfl/fantasy/gut-calls", { headers });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error");
      setGutRecord(data);
    } catch (e) {
      setGutRecord({ error: e.message || "Could not load your record" });
    }
    setGutRecordLoading(false);
  };

  useEffect(() => {
    if (subTab === "fantasy" && fantasyMode === "myRecord" && gutRecord === null && !gutRecordLoading) loadGutRecord();
  }, [subTab, fantasyMode, gutRecord, gutRecordLoading]);

  const runTrade = async () => {
    if (!tradeGive.trim() || !tradeGet.trim()) return;
    setTradeLoading(true); setTradeResult(null);
    try { setTradeResult((await callFantasy("trade", { tradeGive: tradeGive.trim(), tradeGet: tradeGet.trim() })).result); }
    catch (e) { setTradeResult("Error: " + e.message); }
    setTradeLoading(false);
  };

  const runAsk = async () => {
    if (!askQ.trim()) return;
    setAskLoading(true); setAskResult(null);
    try { setAskResult((await callFantasy("ask", { question: askQ.trim() })).result); }
    catch (e) { setAskResult("Error: " + e.message); }
    setAskLoading(false);
  };

  const loadCheatSheet = async () => {
    setCheatSheetLoading(true); setCheatSheetError(null);
    try {
      const headers = await getAuthHeaders();
      const params = new URLSearchParams({ format: scoringToFormat(scoring) });
      if (positionFilter !== "ALL") params.set("position", positionFilter);
      const res = await fetch(`/api/nfl/fantasy/rankings?${params}`, { headers });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error");
      setCheatSheet(data.rankings || []);
    } catch (e) {
      setCheatSheetError(e.message || "Could not load rankings");
      setCheatSheet(prev => prev ?? []);
    }
    setCheatSheetLoading(false);
  };

  useEffect(() => {
    if (subTab === "fantasy" && fantasyMode === "cheatSheet") loadCheatSheet();
  }, [subTab, fantasyMode, scoring, positionFilter]);

  const loadSleeperConnection = async () => {
    setSleeperLoading(true); setSleeperError(null);
    try {
      const headers = await getAuthHeaders();
      const params = new URLSearchParams({ format: scoringToFormat(scoring) });
      const res = await fetch(`/api/nfl/fantasy/sleeper?${params}`, { headers });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error");
      setSleeperConnection(data);
    } catch (e) {
      setSleeperError(e.message || "Could not load your team");
      setSleeperConnection({ connected: false });
    }
    setSleeperLoading(false);
  };

  useEffect(() => {
    if (subTab === "fantasy" && fantasyMode === "myTeam" && sleeperConnection === null && !sleeperLoading) loadSleeperConnection();
  }, [subTab, fantasyMode, sleeperConnection, sleeperLoading]);

  const lookupSleeperUsername = async () => {
    if (!sleeperUsername.trim()) return;
    setSleeperBusy(true); setSleeperError(null); setSleeperLookup(null);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch("/api/nfl/fantasy/sleeper", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ mode: "lookup", username: sleeperUsername.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error");
      if (data.leagues.length === 1) {
        await connectSleeperLeague(data.sleeperUserId, data.username, data.leagues[0]);
      } else {
        setSleeperLookup(data);
      }
    } catch (e) {
      setSleeperError(e.message || "Could not find that Sleeper username");
    }
    setSleeperBusy(false);
  };

  const connectSleeperLeague = async (sleeperUserId, username, league) => {
    setSleeperBusy(true); setSleeperError(null);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch("/api/nfl/fantasy/sleeper", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({
          mode: "connect", sleeperUserId, username,
          leagueId: league.leagueId, leagueName: league.name, season: league.season,
          format: scoringToFormat(scoring),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error");
      setSleeperConnection(data);
      setSleeperLookup(null);
      setSleeperUsername("");
    } catch (e) {
      setSleeperError(e.message || "Could not connect that league");
    }
    setSleeperBusy(false);
  };

  const disconnectSleeper = async () => {
    setSleeperBusy(true);
    try {
      const headers = await getAuthHeaders();
      await fetch("/api/nfl/fantasy/sleeper", { method: "DELETE", headers });
    } catch (e) { console.error("sleeper disconnect error", e); }
    setSleeperConnection({ connected: false });
    setSleeperBusy(false);
  };

  // Quick hand-off from a roster row into the Start/Sit comparison — fills
  // playerA first, then playerB, then wraps back to playerA so tapping the
  // same two players repeatedly stays useful.
  const sendToStartSit = (name) => {
    if (!playerA.trim() || (playerA.trim() && playerB.trim())) { setPlayerA(name); setPlayerB(""); }
    else setPlayerB(name);
    setFantasyMode("startSit");
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
      // Crashed function = HTML error page, not JSON — parse defensively.
      let data = null;
      try { data = await res.json(); } catch {}
      if (!res.ok || !data) throw new Error(data?.error || `Server error (${res.status})`);
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
    background: "#12141a", border: "1px solid #2b2f3a", borderRadius: 10,
    padding: "11px 14px", color: "#fff", fontSize: 14, outline: "none", width: "100%",
  };
  const orangeBtn = (disabled) => accentButtonStyle(NFL_ORANGE, { disabled });

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>

      {/* Sub-nav */}
      <div style={{ display: "flex", gap: 6, padding: "0 20px", borderBottom: `1px solid ${tokens.color.border}`, overflowX: "auto" }}>
        {[
          { id: "fantasy", label: "Fantasy" },
          { id: "picks",   label: "Picks" },
          { id: "record",  label: "Record" },
        ].map(({ id, label }) => (
          <button key={id}
            style={{ ...tabButtonStyle({ active: subTab === id, accent: NFL_ORANGE }), flexShrink: 0 }}
            onClick={() => setSubTab(id)}>
            {label}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, padding: "16px 20px 84px", display: "flex", flexDirection: "column", gap: 14 }}>

        {/* Scoring format */}
        {(subTab === "fantasy") && (
          <div style={{ display: "flex", borderBottom: `1px solid ${tokens.color.border}` }}>
            {["PPR", "Half-PPR", "Standard"].map(fmt => (
              <button key={fmt} onClick={() => setScoring(fmt)} style={{ ...tabButtonStyle({ active: scoring === fmt, accent: NFL_ORANGE }), flex: 1, textAlign: "center" }}>{fmt}</button>
            ))}
          </div>
        )}

        {/* ── FANTASY TAB ── */}
        {subTab === "fantasy" && (
          <>
            {/* Mode selector */}
            <div style={{ display: "flex", borderBottom: `1px solid ${tokens.color.border}` }}>
              {[
                { id: "startSit",   label: "Start/Sit" },
                { id: "trade",      label: "Trade" },
                { id: "ask",        label: "Ask AI" },
                { id: "cheatSheet", label: "Cheat Sheet" },
                { id: "myTeam",     label: "My Team" },
                { id: "myRecord",   label: "Gut vs Model" },
              ].map(({ id, label }) => (
                <button key={id} onClick={() => setFantasyMode(id)} style={{ ...tabButtonStyle({ active: fantasyMode === id, accent: NFL_ORANGE }), flex: 1, textAlign: "center" }}>{label}</button>
              ))}
            </div>

            {fantasyMode === "startSit" && (
              <a href="/calibration" target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: "#666", textAlign: "right", textDecoration: "none" }}>
                See our calibration track record →
              </a>
            )}

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
                  <div style={{ background: "#15171d", border: `1px solid rgba(217,117,74,0.25)`, borderRadius: 14, padding: 16 }}>
                    <div style={{ fontSize: 10, color: NFL_ORANGE, fontWeight: 700, letterSpacing: 1.5, marginBottom: 8 }}>START / SIT · {scoring}</div>
                    {ssProbability && (
                      <div style={{ marginBottom: 14, paddingBottom: 14, borderBottom: "1px solid rgba(217,117,74,0.15)" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 700, color: "#fff", marginBottom: 6 }}>
                          <span>{playerA.trim()} — {ssProbability.playerAProbability}%</span>
                          <span>{playerB.trim()} — {ssProbability.playerBProbability}%</span>
                        </div>
                        <div style={{ height: 6, borderRadius: 3, overflow: "hidden", display: "flex", background: "#2b2f3a" }}>
                          <div style={{ width: `${ssProbability.playerAProbability}%`, background: NFL_ORANGE }} />
                          <div style={{ width: `${ssProbability.playerBProbability}%`, background: "#3a3f4c" }} />
                        </div>
                        {ssProbability.factors?.length > 0 && (
                          <ul style={{ margin: "10px 0 0", padding: "0 0 0 18px", fontSize: 12, color: "#999", lineHeight: 1.6 }}>
                            {ssProbability.factors.map((f, i) => <li key={i}>{f}</li>)}
                          </ul>
                        )}
                      </div>
                    )}
                    <div style={{ fontSize: 13, color: "#ccc", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{ssResult}</div>

                    {ssProbability && (
                      <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid rgba(217,117,74,0.15)" }}>
                        {!gutLogged ? (
                          <>
                            <div style={{ fontSize: 11, color: "#777", marginBottom: 8 }}>Going with your gut instead? Log it — we&apos;ll show you how it did vs the model.</div>
                            <div style={{ display: "flex", gap: 8 }}>
                              <button disabled={gutLogging} onClick={() => logGutCall("A")}
                                style={{ flex: 1, background: "transparent", border: "1px solid #2b2f3a", color: "#ccc", borderRadius: 8, padding: "8px 10px", fontSize: 12, cursor: "pointer" }}>
                                I&apos;m starting {playerA.trim()}
                              </button>
                              <button disabled={gutLogging} onClick={() => logGutCall("B")}
                                style={{ flex: 1, background: "transparent", border: "1px solid #2b2f3a", color: "#ccc", borderRadius: 8, padding: "8px 10px", fontSize: 12, cursor: "pointer" }}>
                                I&apos;m starting {playerB.trim()}
                              </button>
                            </div>
                            {gutError && <div style={{ color: "#D9645C", fontSize: 11, marginTop: 8 }}>{gutError}</div>}
                          </>
                        ) : (
                          <div style={{ fontSize: 12, color: gutLogged.agreedWithModel ? "#2FBF71" : "#D6B23D" }}>
                            Logged — you&apos;re starting {gutLogged.gutPick === "A" ? gutLogged.playerAName : gutLogged.playerBName}, model favored {gutLogged.modelPick === "A" ? gutLogged.playerAName : gutLogged.playerBName} ({gutLogged.modelProbA}%).
                            {gutLogged.agreedWithModel ? " You agreed with the model." : " You&apos;re going against the model."} We&apos;ll grade this once results are in — check Gut vs Model.
                          </div>
                        )}
                      </div>
                    )}
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
                  <div style={{ background: "#15171d", border: `1px solid rgba(217,117,74,0.25)`, borderRadius: 14, padding: 16 }}>
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
                  <div style={{ background: "#15171d", border: `1px solid rgba(217,117,74,0.25)`, borderRadius: 14, padding: 16 }}>
                    <div style={{ fontSize: 10, color: NFL_ORANGE, fontWeight: 700, letterSpacing: 1.5, marginBottom: 8 }}>AI VERDICT · {scoring}</div>
                    <div style={{ fontSize: 13, color: "#ccc", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{askResult}</div>
                  </div>
                )}
              </div>
            )}

            {fantasyMode === "cheatSheet" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", gap: 6, overflowX: "auto" }}>
                  {["ALL", "QB", "RB", "WR", "TE"].map(pos => (
                    <button key={pos} onClick={() => setPositionFilter(pos)}
                      style={{ ...tabButtonStyle({ active: positionFilter === pos, accent: NFL_ORANGE }), flexShrink: 0, padding: "6px 14px" }}>
                      {pos}
                    </button>
                  ))}
                </div>

                {cheatSheetLoading && (
                  <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#555", fontSize: 13, padding: "20px 0" }}>
                    <div style={{ width: 18, height: 18, border: "2px solid #2b2f3a", borderTopColor: NFL_ORANGE, borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
                    Loading rankings…
                  </div>
                )}

                {!cheatSheetLoading && cheatSheetError && (
                  <div style={S.center}>
                    <div style={{ color: "#fff", fontWeight: 700, marginTop: 8 }}>Could not load rankings</div>
                    <div style={{ color: "#777", fontSize: 13, marginTop: 4 }}>{cheatSheetError}</div>
                    <button style={{ ...S.saveBtn, marginTop: 14 }} onClick={loadCheatSheet}>Retry</button>
                  </div>
                )}

                {!cheatSheetLoading && !cheatSheetError && cheatSheet?.length === 0 && (
                  <div style={{ background: "#15171d", border: "1px solid #242832", borderRadius: 14, padding: "28px 16px", textAlign: "center" }}>
                    <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>No rankings yet</div>
                    <div style={{ fontSize: 13, color: "#555", lineHeight: 1.6 }}>Draft rankings refresh weekly as the season approaches. Check back soon.</div>
                  </div>
                )}

                {!cheatSheetLoading && !cheatSheetError && cheatSheet?.map(p => {
                  const t = draftTierStyle(p.tier);
                  return (
                    <div key={p.player_id} style={{ background: "#15171d", border: "1px solid #242832", borderRadius: 14, padding: "12px 14px", display: "flex", alignItems: "center", gap: 12 }}>
                      <div style={{ fontFamily: tokens.font.mono, fontSize: 16, fontWeight: 700, color: "#3d424f", width: 28, textAlign: "center", flexShrink: 0 }}>{p.rank_overall}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <span style={{ fontWeight: 700, fontSize: 14 }}>{p.name}</span>
                          <span style={{ fontSize: 11, color: "#666" }}>{p.position} · {p.team || "FA"}</span>
                          <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 5, background: t.bg, color: t.color, border: `1px solid ${t.color}33` }}>
                            TIER {p.tier}
                          </span>
                        </div>
                        <div style={{ display: "flex", gap: 12, marginTop: 4, fontSize: 11, color: "#888", fontFamily: tokens.font.mono, flexWrap: "wrap" }}>
                          <span>Proj {p.projected_points?.toFixed(1)}</span>
                          <span>Ceil {p.ceiling_points?.toFixed(1)} / Floor {p.floor_points?.toFixed(1)}</span>
                        </div>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end", flexShrink: 0 }}>
                        {p.injury_status && (
                          <span style={{ fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 6, background: "rgba(217,100,92,0.1)", color: "#D9645C", border: "1px solid rgba(217,100,92,0.3)" }}>
                            {p.injury_status}
                          </span>
                        )}
                        {p.trending_add_count > 0 && (
                          <span style={{ fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 6, background: "rgba(47,191,113,0.08)", color: "#2FBF71", border: "1px solid rgba(47,191,113,0.25)" }}>
                            {p.trending_add_count} adds/24h
                          </span>
                        )}
                        {p.personnel_note && (
                          <span style={{ fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 6, background: "rgba(120,140,255,0.08)", color: "#7C8CFF", border: "1px solid rgba(120,140,255,0.25)" }}>
                            {p.personnel_note}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {fantasyMode === "myTeam" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {sleeperLoading && (
                  <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#555", fontSize: 13, padding: "20px 0" }}>
                    <div style={{ width: 18, height: 18, border: "2px solid #2b2f3a", borderTopColor: NFL_ORANGE, borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
                    Loading your team…
                  </div>
                )}

                {!sleeperLoading && sleeperConnection && !sleeperConnection.connected && (
                  <>
                    <div style={{ background: "#15171d", border: "1px solid #242832", borderRadius: 14, padding: 16 }}>
                      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Connect your Sleeper league</div>
                      <div style={{ fontSize: 13, color: "#777", lineHeight: 1.6, marginBottom: 12 }}>
                        Enter your Sleeper username — we&apos;ll pull your leagues and your actual roster, free and read-only.
                      </div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <input style={inputStyle} placeholder="Sleeper username" value={sleeperUsername}
                          onChange={e => setSleeperUsername(e.target.value)}
                          onKeyDown={e => e.key === "Enter" && lookupSleeperUsername()} />
                        <button style={{ ...orangeBtn(!sleeperUsername.trim() || sleeperBusy), flexShrink: 0 }}
                          disabled={!sleeperUsername.trim() || sleeperBusy}
                          onClick={lookupSleeperUsername}>
                          {sleeperBusy ? "…" : "Find leagues →"}
                        </button>
                      </div>
                      {sleeperError && <div style={{ color: "#D9645C", fontSize: 12, marginTop: 10 }}>{sleeperError}</div>}
                    </div>

                    {sleeperLookup?.leagues?.length > 1 && (
                      <div style={{ background: "#15171d", border: "1px solid #242832", borderRadius: 14, padding: 16 }}>
                        <div style={{ fontSize: 11, color: "#777", marginBottom: 10, letterSpacing: 0.5 }}>WHICH LEAGUE?</div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                          {sleeperLookup.leagues.map(l => (
                            <button key={l.leagueId}
                              disabled={sleeperBusy}
                              onClick={() => connectSleeperLeague(sleeperLookup.sleeperUserId, sleeperLookup.username, l)}
                              style={{ ...S.saveBtn, textAlign: "left", justifyContent: "flex-start" }}>
                              {l.name} <span style={{ color: "#777", fontWeight: 400 }}>&nbsp;· {l.totalRosters} teams</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}

                {!sleeperLoading && sleeperConnection?.connected && (
                  <>
                    <div style={{ background: "#15171d", border: `1px solid rgba(217,117,74,0.25)`, borderRadius: 14, padding: 16, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>{sleeperConnection.teamName || "My Team"}</div>
                        <div style={{ fontSize: 12, color: "#777", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sleeperConnection.league?.name}</div>
                      </div>
                      <button style={{ background: "transparent", border: "1px solid #2b2f3a", color: "#777", borderRadius: 8, padding: "6px 12px", fontSize: 12, flexShrink: 0 }}
                        disabled={sleeperBusy} onClick={disconnectSleeper}>
                        Disconnect
                      </button>
                    </div>

                    {sleeperConnection.error && (
                      <div style={{ color: "#D9645C", fontSize: 12 }}>{sleeperConnection.error}</div>
                    )}

                    <div style={{ fontSize: 11, color: "#555", padding: "0 2px" }}>Tap two players to send them to Start/Sit.</div>

                    {sleeperConnection.players?.map(p => {
                      const t = draftTierStyle(p.tier);
                      return (
                        <button key={p.sleeperId} onClick={() => sendToStartSit(p.name)}
                          style={{ background: "#15171d", border: "1px solid #242832", borderRadius: 14, padding: "12px 14px", display: "flex", alignItems: "center", gap: 12, textAlign: "left", cursor: "pointer" }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                              <span style={{ fontWeight: 700, fontSize: 14, color: "#fff" }}>{p.name}</span>
                              <span style={{ fontSize: 11, color: "#666" }}>{p.position || "?"} · {p.team || "FA"}</span>
                              {p.ranked && (
                                <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 5, background: t.bg, color: t.color, border: `1px solid ${t.color}33` }}>
                                  TIER {p.tier}
                                </span>
                              )}
                            </div>
                            {p.ranked ? (
                              <div style={{ display: "flex", gap: 12, marginTop: 4, fontSize: 11, color: "#888", fontFamily: tokens.font.mono, flexWrap: "wrap" }}>
                                <span>Proj {p.projectedPoints?.toFixed(1)}</span>
                                <span>Ceil {p.ceilingPoints?.toFixed(1)} / Floor {p.floorPoints?.toFixed(1)}</span>
                              </div>
                            ) : (
                              <div style={{ fontSize: 11, color: "#555", marginTop: 4 }}>Not in our rankings yet</div>
                            )}
                          </div>
                          {p.injuryStatus && (
                            <span style={{ fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 6, background: "rgba(217,100,92,0.1)", color: "#D9645C", border: "1px solid rgba(217,100,92,0.3)", flexShrink: 0 }}>
                              {p.injuryStatus}
                            </span>
                          )}
                        </button>
                      );
                    })}

                    {sleeperConnection.players?.length === 0 && !sleeperConnection.error && (
                      <div style={{ background: "#15171d", border: "1px solid #242832", borderRadius: 14, padding: "28px 16px", textAlign: "center", color: "#555", fontSize: 13 }}>
                        No players found on your roster.
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {fantasyMode === "myRecord" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {gutRecordLoading && (
                  <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#555", fontSize: 13, padding: "20px 0" }}>
                    <div style={{ width: 18, height: 18, border: "2px solid #2b2f3a", borderTopColor: NFL_ORANGE, borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
                    Loading your record…
                  </div>
                )}

                {!gutRecordLoading && gutRecord?.error && (
                  <div style={S.center}>
                    <div style={{ color: "#fff", fontWeight: 700, marginTop: 8 }}>Could not load your record</div>
                    <div style={{ color: "#777", fontSize: 13, marginTop: 4 }}>{gutRecord.error}</div>
                    <button style={{ ...S.saveBtn, marginTop: 14 }} onClick={() => { setGutRecord(null); loadGutRecord(); }}>Retry</button>
                  </div>
                )}

                {!gutRecordLoading && gutRecord && !gutRecord.error && gutRecord.summary.total === 0 && (
                  <div style={{ background: "#15171d", border: "1px solid #242832", borderRadius: 14, padding: "28px 16px", textAlign: "center" }}>
                    <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>No calls logged yet</div>
                    <div style={{ fontSize: 13, color: "#555", lineHeight: 1.6 }}>Run a Start/Sit comparison, then log which player you actually went with. We&apos;ll track you vs the model all season.</div>
                  </div>
                )}

                {!gutRecordLoading && gutRecord && !gutRecord.error && gutRecord.summary.total > 0 && (
                  <>
                    <div style={{ background: "#15171d", border: `1px solid rgba(217,117,74,0.25)`, borderRadius: 14, padding: 16 }}>
                      <div style={{ fontSize: 10, color: NFL_ORANGE, fontWeight: 700, letterSpacing: 1.5, marginBottom: 10 }}>YOU VS THE MODEL</div>
                      <div style={{ display: "flex", gap: 20 }}>
                        <div>
                          <div style={{ fontSize: 20, fontWeight: 700, fontFamily: tokens.font.mono }}>{gutRecord.summary.gutRecord || "—"}</div>
                          <div style={{ fontSize: 11, color: "#777" }}>Your record</div>
                        </div>
                        <div>
                          <div style={{ fontSize: 20, fontWeight: 700, fontFamily: tokens.font.mono }}>{gutRecord.summary.modelRecord || "—"}</div>
                          <div style={{ fontSize: 11, color: "#777" }}>Model&apos;s record</div>
                        </div>
                        <div>
                          <div style={{ fontSize: 20, fontWeight: 700, fontFamily: tokens.font.mono }}>{gutRecord.summary.agreed}/{gutRecord.summary.total}</div>
                          <div style={{ fontSize: 11, color: "#777" }}>Agreed with model</div>
                        </div>
                      </div>
                      {gutRecord.summary.resolved === 0 && (
                        <div style={{ fontSize: 11, color: "#555", marginTop: 12 }}>Nothing resolved yet — check back once this week&apos;s games are final.</div>
                      )}
                    </div>

                    {gutRecord.calls.map(c => {
                      const agreed = c.gut_pick === c.model_pick;
                      const yourPick = c.gut_pick === "A" ? c.player_a_name : c.player_b_name;
                      const modelPick = c.model_pick === "A" ? c.player_a_name : c.player_b_name;
                      return (
                        <div key={c.id} style={{ background: "#15171d", border: "1px solid #242832", borderRadius: 14, padding: "12px 14px" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <div style={{ fontSize: 13, fontWeight: 700 }}>{c.player_a_name} vs {c.player_b_name}</div>
                            <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 5, color: agreed ? "#2FBF71" : "#D6B23D", background: agreed ? "rgba(47,191,113,0.08)" : "rgba(214,178,61,0.08)" }}>
                              {agreed ? "AGREED" : "WENT WITH GUT"}
                            </span>
                          </div>
                          <div style={{ fontSize: 11, color: "#888", marginTop: 6 }}>
                            You: {yourPick} · Model: {modelPick} ({c.model_prob_a}%)
                          </div>
                          <div style={{ fontSize: 11, color: c.resolved ? (c.actual_winner ? "#888" : "#555") : "#555", marginTop: 4 }}>
                            {c.resolved && c.actual_winner ? `Result: ${c.actual_winner === "push" ? "push" : (c.actual_winner === "A" ? c.player_a_name : c.player_b_name) + " scored more"}` : "Pending"}
                          </div>
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
            )}
          </>
        )}

        {/* ── PICKS TAB — non-Pro: odds teaser ── */}
        {subTab === "picks" && !isPro && (
          <>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 7, background: "rgba(217,117,74,0.06)", border: "1px solid rgba(217,117,74,0.2)", borderRadius: 30, padding: "4px 12px", alignSelf: "flex-start" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: NFL_ORANGE, display: "inline-block", animation: "pulse 1.5s ease-in-out infinite" }} />
              <span style={{ fontSize: 10, color: NFL_ORANGE, fontWeight: 700, letterSpacing: 1.5 }}>LIVE ODDS · NFL</span>
            </div>

            {nflGames === null && !nflLoading && (
              <button style={orangeBtn(false)} onClick={loadOdds}>Load NFL odds →</button>
            )}
            {nflLoading && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#555", fontSize: 13 }}>
                <div style={{ width: 18, height: 18, border: "2px solid #2b2f3a", borderTopColor: NFL_ORANGE, borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
                Loading odds…
              </div>
            )}
            {nflMsg && <div style={{ fontSize: 12, color: "#555", textAlign: "center" }}>{nflMsg}</div>}
            {nflGames !== null && nflGames.length === 0 && !nflMsg && (
              <div style={{ background: "#15171d", border: "1px solid #242832", borderRadius: 14, padding: "28px 16px", textAlign: "center" }}>
                <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>No games on the board</div>
                <div style={{ fontSize: 13, color: "#555", lineHeight: 1.6 }}>NFL odds will appear here during preseason and the regular season. Check back in August.</div>
              </div>
            )}
            {nflGames?.map(g => (
              <div key={g.id} style={{ background: "#15171d", border: "1px solid #242832", borderRadius: 14, padding: 16, animation: "fadeUp 0.3s ease" }}>
                <div style={{ fontSize: 11, color: "#555", marginBottom: 8 }}>{fmtGameTime(g.commenceTime)}</div>
                <div style={{ fontFamily: tokens.font.mono, fontSize: 15, fontWeight: 700, marginBottom: 12 }}>
                  <TeamMatchupLink sport="nfl" awayTeam={g.awayTeam} homeTeam={g.homeTeam} onPick={onTeamClick} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                  {[
                    { label: "ML", away: fmtOdds(g.awayOdds), home: fmtOdds(g.homeOdds) },
                    { label: `SPREAD (${g.spread > 0 ? "+" : ""}${g.spread ?? "—"})`, away: fmtOdds(g.awaySpreadOdds), home: fmtOdds(g.homeSpreadOdds) },
                    { label: `TOTAL (${g.total ?? "—"})`, away: `O ${fmtOdds(g.overOdds)}`, home: `U ${fmtOdds(g.underOdds)}` },
                  ].map(({ label, away, home }) => (
                    <div key={label} style={{ background: "#10131a", border: "1px solid #242832", borderRadius: 10, padding: "10px 10px" }}>
                      <div style={{ fontSize: 9, color: "#444", fontWeight: 700, letterSpacing: 1, marginBottom: 6 }}>{label}</div>
                      <div style={{ fontFamily: tokens.font.mono, fontSize: 12, color: "#888", marginBottom: 2 }}>{away}</div>
                      <div style={{ fontFamily: tokens.font.mono, fontSize: 12, color: "#888" }}>{home}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {nflGames !== null && nflGames.length > 0 && (
              <button style={{ ...orangeBtn(false), marginTop: 4, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }} onClick={loadOdds}><RefreshIcon size={13} /> Refresh</button>
            )}
            <div style={{ background: "#10131a", border: "1px solid #242832", borderRadius: 14, padding: "16px" }}>
              <div style={{ fontSize: 10, color: NFL_ORANGE, fontWeight: 700, letterSpacing: 2, marginBottom: 8 }}>MODEL PICKS</div>
              <div style={{ fontSize: 13, color: "#555", lineHeight: 1.6 }}>
                Spread, moneyline, and total picks with BET/PASS/TRAP verdicts are live now — generated weekly by the same model pipeline as MLB.
              </div>
              <button style={{ ...S.saveBtn, marginTop: 12, background: "#2FBF71", color: "#000", borderColor: "#2FBF71" }} onClick={() => setUpgradeModal(true)}>Upgrade to Pro</button>
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
              <div style={{ color: "#fff", fontWeight: 700, marginTop: 8 }}>Could not load games</div>
              <div style={{ color: "#777", fontSize: 13, marginTop: 4 }}>{nflPicksError}</div>
              <button style={{ ...S.saveBtn, marginTop: 14 }} onClick={() => fetchNflPicks(selectedDate, true)}>Retry</button>
            </div>
          ) : nflPicks.length === 0 ? (
            <div style={S.center}>
              <div style={{ color: "#fff", fontWeight: 700, marginTop: 8 }}>No games found</div>
              <div style={{ color: "#777", fontSize: 13, marginTop: 4 }}>Try a different date</div>
            </div>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "6px 0", borderBottom: "1px solid #1c1f26", marginBottom: 4 }}>
                <span style={{ fontSize: 11, color: "#777" }}>{nflPicks.length} picks</span>
                <span style={{ fontSize: 11, color: "#2FBF71" }}>{nflPicks.filter(p => p.isBet).length} BET</span>
                <span style={{ fontSize: 11, color: "#555" }}>{nflPicks.filter(p => !p.isBet).length} PASS</span>
                <button style={{ ...iconButtonStyle({}), marginLeft: "auto" }} onClick={() => fetchNflPicks(selectedDate, true)} title="Refresh picks"><RefreshIcon size={14} /></button>
                {isAdmin && (
                  <button
                    style={{ ...iconButtonStyle({ active: nflGenerating }), fontSize: 11 }}
                    onClick={generateNflPicks}
                    disabled={nflGenerating}
                    title="Force-generate NFL picks for this date"
                  >{nflGenerating ? "…" : "Gen"}</button>
                )}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 10, alignItems: "start" }}>
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
                const cardBorder = isOpen ? (isBet ? "#2FBF71" : "#333947") : (isBet ? "rgba(47,191,113,0.25)" : "#242832");

                return (
                  <div key={pick.id} style={{ ...S.card, borderColor: cardBorder, gridColumn: isOpen ? "1 / -1" : undefined, cursor: isOpen ? "default" : "pointer" }} onClick={isOpen ? undefined : () => setNflExpanded(pick.id)}>
                  {(() => {
                    const badgeRow = (
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                        <span style={{
                          fontSize: 11, fontWeight: 800, padding: "3px 10px", borderRadius: 6, letterSpacing: 1.5,
                          background: verdict === "TRAP" ? "rgba(217,100,92,0.1)" : isBet ? "rgba(47,191,113,0.08)" : "rgba(50,50,50,0.5)",
                          color: verdict === "TRAP" ? "#D9645C" : isBet ? "#2FBF71" : "#3d424f",
                          border: `1px solid ${verdict === "TRAP" ? "rgba(217,100,92,0.3)" : isBet ? "rgba(47,191,113,0.2)" : "#2b2f3a"}`,
                        }}>
                          {verdict === "TRAP" ? "TRAP" : isBet ? "BET" : "PASS"}
                        </span>
                        <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 5, background: "#181b22", color: "#888", letterSpacing: 0.5 }}>
                          {pick.marketType === "spread" ? "SPREAD" : pick.marketType === "total" ? "TOTAL" : "MONEYLINE"}
                        </span>
                      </div>
                    );
                    const matchupEl = <TeamMatchupLink sport="nfl" awayTeam={pick.awayTeam} homeTeam={pick.homeTeam} awayLabel={pick.awayTeam?.split(" ").pop()} homeLabel={pick.homeTeam?.split(" ").pop()} onPick={onTeamClick} />;
                    const saveBtnEl = (
                      <button
                        style={{ ...S.saveBtn, background: isNflSaved ? "#2FBF71" : "transparent", color: isNflSaved ? "#000" : "#2FBF71", borderColor: "#2FBF71", flexShrink: 0 }}
                        onClick={(e) => { e.stopPropagation(); savePick(pick, "nfl"); }}
                      >
                        {isNflSaved ? <><CheckIcon size={12} /> Saved</> : "+ Save"}
                      </button>
                    );

                    return !isOpen ? (
                      <>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                          {badgeRow}
                          {saveBtnEl}
                        </div>
                        <div style={{ ...S.cardMatchup, marginTop: 6 }}>{matchupEl}</div>
                      </>
                    ) : (
                    <div style={S.cardTop}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        {badgeRow}
                        <div style={S.cardMatchup}>{matchupEl}</div>
                        <div style={S.cardMeta}>
                          {fmtGameTime(pick.commenceTime)}
                          {pick.pick && <> · Take{" "}
                            <span style={{ color: isBet ? "#2FBF71" : "#aaa", fontWeight: 700 }}>
                              {pick.pick?.split(" ").pop()}
                              {spreadLine != null ? ` ${spreadLine > 0 ? "+" : ""}${spreadLine}` : ""}
                              {totalLine != null ? ` ${totalLine}` : ""}
                            </span>
                          </>}
                          {pickOdds != null && <span style={{ color: "#888", fontFamily: tokens.font.mono }}> · {fmtOdds(pickOdds)}</span>}
                        </div>
                        {(!pick.marketType || pick.marketType === "moneyline") && (
                          <WinPctRow homeTeam={pick.homeTeam} awayTeam={pick.awayTeam} homeOdds={pick.homeOdds} awayOdds={pick.awayOdds} />
                        )}
                        <div style={{ marginTop: 7, display: "flex", alignItems: "center", gap: 7 }}>
                          <div style={{ flex: 1, height: 3, background: "#181b22", borderRadius: 2 }}>
                            <div style={{ height: "100%", borderRadius: 2, width: `${Math.min(100, edge * 6)}%`, background: isBet ? t.color : "#2b2f3a", transition: "width 0.5s ease" }} />
                          </div>
                          {f && <span style={{ fontSize: 10, color: isBet ? t.color : "#3d424f", fontFamily: tokens.font.mono, flexShrink: 0 }}>{edge.toFixed(1)}%</span>}
                        </div>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end", flexShrink: 0 }}>
                        {saveBtnEl}
                        <button
                          style={{ ...S.expandBtn, borderColor: isOpen ? (isBet ? "#2FBF71" : "#444") : "#2b2f3a", color: isOpen ? (isBet ? "#2FBF71" : "#444") : "#3d424f" }}
                          onClick={() => setNflExpanded(isOpen ? null : pick.id)}
                        >
                          {isOpen ? "▲" : "▼"}
                        </button>
                      </div>
                    </div>
                    );
                  })()}
                    {isOpen && f && (
                      <div style={{ animation: "fadeUp 0.2s ease" }}>
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
                        <div style={S.expDivider} />
                        <div style={S.expSection}>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#888", marginBottom: 4 }}>
                            <span>Confidence</span><span style={{ color: "#ccc", fontFamily: tokens.font.mono }}>{f.confidence}/10</span>
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#888", marginBottom: 4 }}>
                            <span>Model win prob</span><span style={{ color: "#ccc", fontFamily: tokens.font.mono }}>{f.trueWinProbPct}%</span>
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#888", marginBottom: 4 }}>
                            <span>Market implied</span><span style={{ color: "#ccc", fontFamily: tokens.font.mono }}>{f.marketImpliedPct}%</span>
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#888", marginBottom: 4 }}>
                            <span>Uncertainty</span><span style={{ color: "#ccc", fontFamily: tokens.font.mono }}>±{f.uncertaintyPct}%</span>
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#888" }}>
                            <span>Data variance</span><span style={{ color: "#ccc" }}>{f.variance}</span>
                          </div>
                          {f.failures?.length > 0 && (
                            <div style={{ marginTop: 8, fontSize: 11, color: "#666", lineHeight: 1.5 }}>
                              {f.failures.map((fail, i) => <div key={i}>· {fail}</div>)}
                            </div>
                          )}
                          {(() => {
                            const reasons = translateReasons(f.confidenceReasons, "nfl").slice(0, 5);
                            const pickOdds = pickOddsFor(pick);
                            const betNow = pick.modelProb != null ? shouldBetNow(pickOdds, pick.modelProb / 100) : null;
                            return (
                              <>
                                {reasons.length > 0 && (
                                  <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                                    <div style={{ fontSize: 9, color: "#888", letterSpacing: 1, marginBottom: 6 }}>WHY THIS SCORE</div>
                                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                      {reasons.map((r, i) => (
                                        <div key={i} style={{ fontSize: 11, color: "#ccc", display: "flex", gap: 6 }}>
                                          <span style={{ color: r.sign === "-" ? "#D9645C" : "#2FBF71", flexShrink: 0 }}>{r.sign === "-" ? "✗" : "✓"}</span>
                                          <span>{r.text}</span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                                {betNow && (
                                  <div style={{ marginTop: 10, background: "#181b22", borderRadius: 8, padding: "8px 10px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                    <div style={{ fontSize: 10, color: "#888" }}>
                                      Current <b style={{ color: "#ccc" }}>{fmtOdds(betNow.currentOdds)}</b> · Fair <b style={{ color: "#ccc" }}>{fmtOdds(betNow.fairOdds)}</b>
                                    </div>
                                    <div style={{ fontSize: 11, fontWeight: 700, color: betNow.verdict === "bet" ? "#2FBF71" : "#D6B23D" }}>
                                      {betNow.verdict === "bet" ? "Bet Now" : "Wait"}
                                    </div>
                                  </div>
                                )}
                              </>
                            );
                          })()}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              </div>
            </>
          )
        )}

        {/* ── RECORD TAB ── */}
        {subTab === "record" && (
          <div style={{ background: "#10131a", border: "1px solid rgba(217,117,74,0.2)", borderRadius: 16, padding: "20px 18px" }}>
            <div style={{ fontSize: 10, color: NFL_ORANGE, fontWeight: 700, letterSpacing: 2, marginBottom: 10 }}>NFL RECORD</div>
            <div style={{ fontFamily: tokens.font.mono, fontSize: 18, fontWeight: 700, marginBottom: 8, lineHeight: 1.2 }}>
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
                <div key={label} style={{ background: "#15171d", border: "1px solid #242832", borderRadius: 10, padding: "14px 10px", textAlign: "center" }}>
                  <div style={{ fontFamily: tokens.font.mono, fontSize: 18, fontWeight: 700, color: value != null ? "#fff" : "#2b2f3a" }}>{value ?? "—"}</div>
                  <div style={{ fontSize: 10, color: "#3d424f", marginTop: 4, letterSpacing: 1 }}>{label.toUpperCase()}</div>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
