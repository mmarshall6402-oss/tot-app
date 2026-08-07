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

import { useState, useEffect, useRef } from "react";
import { impliedWinPct, oddsMovement } from "../lib/odds-display.js";
import { TeamMatchupLink } from "./TeamModal.js";
import TeamLogo from "./TeamLogo.js";
import { translateReasons } from "../lib/reason-labels.js";
import { shouldBetNow } from "../lib/fair-odds.js";
import { accentButtonStyle, tabButtonStyle, tokens, iconButtonStyle } from "../lib/ui-theme.js";
import { CheckIcon, RefreshIcon } from "./icons.js";
import { nflHeadshotUrl } from "../lib/nfl-roster.js";
import PlayerHeadshot from "./PlayerHeadshot.js";

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

const FANTASY_POSITIONS = ["QB", "RB", "WR", "TE"];

// Typeahead over the real player catalog (/api/search, sport=nfl) — replaces
// a plain free-text field so Start/Sit and Trade always ground on an exact
// roster player instead of the backend fuzzy-matching (or failing to match
// and silently falling back to Claude guessing) whatever the user typed.
// Selecting a suggestion hands the exact {id, name, team, position} object
// back via onSelectPlayer, which app/api/nfl/fantasy/route.js uses directly
// instead of re-resolving the name server-side.
function PlayerSearchInput({ value, onChangeText, onSelectPlayer, placeholder, getAuthHeaders, onEnter, style }) {
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const boxRef = useRef(null);

  useEffect(() => {
    const q = (value || "").trim();
    // Below the search floor, just let render-time (showDropdown requires
    // length >= 2) hide whatever's left over — no state to reset here.
    if (q.length < 2) return;
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const headers = await getAuthHeaders();
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&sport=nfl`, { headers });
        const data = await res.json();
        if (!cancelled) {
          setResults((data.players || []).filter(p => FANTASY_POSITIONS.includes(p.position)));
          setHighlighted(0);
        }
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 200);
    return () => { cancelled = true; clearTimeout(t); };
  }, [value, getAuthHeaders]);

  useEffect(() => {
    const onDocMouseDown = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, []);

  const select = (p) => {
    onSelectPlayer(p);
    onChangeText(p.name);
    setOpen(false);
  };

  const showDropdown = open && value.trim().length >= 2 && (results.length > 0 || loading);

  return (
    <div ref={boxRef} style={{ position: "relative", flex: 1, minWidth: 0 }}>
      <input
        style={style}
        value={value}
        placeholder={placeholder}
        onChange={e => { onChangeText(e.target.value); onSelectPlayer(null); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={e => {
          if (e.key === "ArrowDown" && results.length) { e.preventDefault(); setHighlighted(h => Math.min(h + 1, results.length - 1)); }
          else if (e.key === "ArrowUp" && results.length) { e.preventDefault(); setHighlighted(h => Math.max(h - 1, 0)); }
          else if (e.key === "Enter") {
            if (open && results[highlighted]) { e.preventDefault(); select(results[highlighted]); }
            else onEnter?.();
          } else if (e.key === "Escape") setOpen(false);
        }}
      />
      {showDropdown && (
        <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, background: "#15171d", border: "1px solid #242832", borderRadius: 10, zIndex: 50, maxHeight: 220, overflowY: "auto", boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }}>
          {loading && !results.length && <div style={{ padding: "10px 12px", fontSize: 12, color: "#555" }}>Searching…</div>}
          {results.map((p, i) => (
            <div key={p.id} onMouseDown={() => select(p)}
              style={{ padding: "8px 12px", cursor: "pointer", display: "flex", alignItems: "center", gap: 10, background: i === highlighted ? "rgba(217,117,74,0.14)" : "transparent", borderTop: i === 0 ? "none" : "1px solid #1c1f26" }}>
              <PlayerHeadshot src={nflHeadshotUrl(p.id)} name={p.name} size={28} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#eee" }}>{p.name}</div>
                <div style={{ fontSize: 11, color: "#666" }}>{p.position} · {p.team || "FA"}{p.injuryStatus ? ` · ${p.injuryStatus}` : ""}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Multi-select variant for Trade, where a side of the deal can hold more
// than one player. Reuses the same /api/search typeahead as
// PlayerSearchInput, but selecting a result adds it to a `players` array
// instead of overwriting a single value, and already-picked players are
// filtered out of the dropdown (and rendered as a removable list with
// headshots below the search box) so the same player can't be added twice.
function PlayerMultiSearch({ players, onChange, placeholder, getAuthHeaders, onEnter, style }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const boxRef = useRef(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const headers = await getAuthHeaders();
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&sport=nfl`, { headers });
        const data = await res.json();
        if (!cancelled) {
          const picked = new Set(players.map(p => p.id));
          setResults((data.players || []).filter(p => FANTASY_POSITIONS.includes(p.position) && !picked.has(p.id)));
          setHighlighted(0);
        }
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 200);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query, players, getAuthHeaders]);

  useEffect(() => {
    const onDocMouseDown = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, []);

  const add = (p) => {
    onChange([...players, p]);
    setQuery("");
    setResults([]);
    setOpen(false);
  };
  const remove = (id) => onChange(players.filter(p => p.id !== id));

  const showDropdown = open && query.trim().length >= 2 && (results.length > 0 || loading);

  return (
    <div ref={boxRef} style={{ position: "relative" }}>
      <input
        style={style}
        value={query}
        placeholder={placeholder}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={e => {
          if (e.key === "ArrowDown" && results.length) { e.preventDefault(); setHighlighted(h => Math.min(h + 1, results.length - 1)); }
          else if (e.key === "ArrowUp" && results.length) { e.preventDefault(); setHighlighted(h => Math.max(h - 1, 0)); }
          else if (e.key === "Enter") {
            if (open && results[highlighted]) { e.preventDefault(); add(results[highlighted]); }
            else onEnter?.();
          } else if (e.key === "Escape") setOpen(false);
        }}
      />
      {showDropdown && (
        <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, background: "#15171d", border: "1px solid #242832", borderRadius: 10, zIndex: 50, maxHeight: 220, overflowY: "auto", boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }}>
          {loading && !results.length && <div style={{ padding: "10px 12px", fontSize: 12, color: "#555" }}>Searching…</div>}
          {results.map((p, i) => (
            <div key={p.id} onMouseDown={() => add(p)}
              style={{ padding: "8px 12px", cursor: "pointer", display: "flex", alignItems: "center", gap: 10, background: i === highlighted ? "rgba(217,117,74,0.14)" : "transparent", borderTop: i === 0 ? "none" : "1px solid #1c1f26" }}>
              <PlayerHeadshot src={nflHeadshotUrl(p.id)} name={p.name} size={28} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#eee" }}>{p.name}</div>
                <div style={{ fontSize: 11, color: "#666" }}>{p.position} · {p.team || "FA"}{p.injuryStatus ? ` · ${p.injuryStatus}` : ""}</div>
              </div>
            </div>
          ))}
        </div>
      )}
      {!!players.length && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
          {players.map(p => (
            <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, background: "#15171d", border: "1px solid #242832", borderRadius: 10, padding: "6px 8px 6px 6px" }}>
              <PlayerHeadshot src={nflHeadshotUrl(p.id)} name={p.name} size={32} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#eee" }}>{p.name}</div>
                <div style={{ fontSize: 11, color: "#666" }}>{p.position} · {p.team || "FA"}</div>
              </div>
              <button onClick={() => remove(p.id)} aria-label={`Remove ${p.name}`}
                style={{ background: "transparent", border: "none", color: "#666", fontSize: 16, lineHeight: 1, cursor: "pointer", padding: "4px 8px", flexShrink: 0 }}>
                ×
              </button>
            </div>
          ))}
        </div>
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

// Cheat Sheet "signal" filter — narrows the list to players carrying a
// specific ceilingVorp-adjustment badge (see lib/nfl-fantasy/*-adjustment.js)
// instead of scrolling the full board looking for them.
// "Value"/"Reach" thresholds: a player has to be off market ADP by a full
// round (10 picks) before it's worth surfacing as a signal rather than
// normal rank/ADP noise.
const ADP_SIGNAL_THRESHOLD = 10;

const SIGNAL_FILTERS = [
  { id: "ALL", label: "All", test: () => true },
  { id: "VALUE", label: "ADP Value", test: (p) => p.adp_diff >= ADP_SIGNAL_THRESHOLD },
  { id: "REACH", label: "ADP Reach", test: (p) => p.adp_diff <= -ADP_SIGNAL_THRESHOLD },
  { id: "TRENDING", label: "Trending", test: (p) => p.trending_add_count > 0 },
  { id: "INJURY", label: "Injury Risk", test: (p) => !!p.injury_status },
  { id: "PERSONNEL", label: "Personnel", test: (p) => !!p.personnel_note },
  { id: "PACE", label: "Pace", test: (p) => !!p.pace_note },
  { id: "PLAYCALLER", label: "Playcaller", test: (p) => !!p.playcaller_note },
];

// adp_diff = market ADP − our rank. Positive: the market is drafting him
// later than we'd take him (a value). Negative: the market is drafting him
// ahead of our rank (a reach).
function adpDiffStyle(diff) {
  if (diff >= ADP_SIGNAL_THRESHOLD) return { color: "#2FBF71", bg: "rgba(47,191,113,0.08)", border: "rgba(47,191,113,0.25)" };
  if (diff <= -ADP_SIGNAL_THRESHOLD) return { color: "#D9645C", bg: "rgba(217,100,92,0.1)", border: "rgba(217,100,92,0.3)" };
  return { color: "#888", bg: "rgba(136,136,136,0.08)", border: "rgba(136,136,136,0.25)" };
}

function fmtPropOdds(o) {
  return o == null ? "" : o > 0 ? `+${o}` : `${o}`;
}

// Renders the actual prop digits from our own propLine data, never from
// Claude's prose — see app/api/nfl/fantasy/route.js's playerContextAndProp
// for why. A player with no posted line gets an explicit "no line yet" chip
// instead of just not showing anything, so the gap reads as an honest
// answer rather than a missing feature.
function PropLineRow({ name, propLine }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "6px 0", fontSize: 12 }}>
      <span style={{ color: "#888", fontWeight: 600 }}>{name}</span>
      {propLine ? (
        <span style={{ color: "#ccc", fontFamily: "monospace", fontSize: 11 }}>
          {propLine.line} {propLine.label} <span style={{ color: "#555" }}>({propLine.bookmaker} O {fmtPropOdds(propLine.overOdds)}/U {fmtPropOdds(propLine.underOdds)})</span>
        </span>
      ) : (
        <span style={{ color: "#555", fontSize: 10, fontWeight: 700, letterSpacing: 0.5, background: "#1c1f26", border: "1px solid #242832", borderRadius: 5, padding: "2px 7px" }}>
          NO LINE POSTED YET
        </span>
      )}
    </div>
  );
}

// Shared renderer for the startSit/trade structured verdict — result is
// either the {verdict,bullets,marketNote,confidence,players} object from
// the API, or a plain "Error: ..." string from a failed call.
function VerdictCard({ result, label, scoring }) {
  if (typeof result === "string") {
    return (
      <div style={{ background: "#15171d", border: `1px solid rgba(217,117,74,0.25)`, borderRadius: 14, padding: 16 }}>
        <div style={{ fontSize: 10, color: NFL_ORANGE, fontWeight: 700, letterSpacing: 1.5, marginBottom: 8 }}>{label} · {scoring}</div>
        <div style={{ fontSize: 13, color: "#ccc", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{result}</div>
      </div>
    );
  }
  const { verdict, bullets, marketNote, confidence, players } = result;
  return (
    <div style={{ background: "#15171d", border: `1px solid rgba(217,117,74,0.25)`, borderRadius: 14, padding: 16 }}>
      <div style={{ fontSize: 10, color: NFL_ORANGE, fontWeight: 700, letterSpacing: 1.5, marginBottom: 8 }}>{label} · {scoring}</div>
      <div style={{ fontSize: 15, fontWeight: 800, color: "#fff", marginBottom: 8 }}>{verdict}</div>
      {(bullets || []).map((b, i) => (
        <div key={i} style={{ fontSize: 13, color: "#ccc", lineHeight: 1.6, marginBottom: 4 }}>• {b}</div>
      ))}
      {marketNote && <div style={{ fontSize: 12, color: "#999", fontStyle: "italic", marginTop: 8 }}>{marketNote}</div>}
      {confidence && <div style={{ fontSize: 11, color: "#666", marginTop: 8 }}>{confidence}</div>}
      {!!players?.length && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #242832" }}>
          {players.map((p, i) => p.name && <PropLineRow key={i} name={p.name} propLine={p.propLine} />)}
        </div>
      )}
    </div>
  );
}

export default function NFLSection({ S, getAuthHeaders, isPro, isAdmin, setUpgradeModal, savePick, saving, selectedDate, onTeamClick }) {
  const [subTab, setSubTab] = useState("fantasy");
  const [scoring, setScoring] = useState("PPR");
  const [fantasyMode, setFantasyMode] = useState("startSit");

  // Start/Sit state
  const [playerA, setPlayerA] = useState("");
  const [playerB, setPlayerB] = useState("");
  const [playerAInfo, setPlayerAInfo] = useState(null);
  const [playerBInfo, setPlayerBInfo] = useState(null);
  const [ssResult, setSsResult] = useState(null);
  const [ssLoading, setSsLoading] = useState(false);

  // Trade state — each side can hold multiple players (a real trade isn't
  // always 1-for-1), so these are arrays of resolved {id,name,team,position}
  // objects picked from PlayerMultiSearch rather than a single value.
  const [tradeGiveInfos, setTradeGiveInfos] = useState([]);
  const [tradeGetInfos, setTradeGetInfos] = useState([]);
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
  const [signalFilter, setSignalFilter] = useState("ALL");
  const [filtersOpen, setFiltersOpen] = useState(false);

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
    try {
      setSsResult(await callFantasy("startSit", {
        playerA: playerA.trim(), playerB: playerB.trim(),
        playerAInfo, playerBInfo,
      }));
    }
    catch (e) { setSsResult("Error: " + e.message); }
    setSsLoading(false);
  };

  const runTrade = async () => {
    if (!tradeGiveInfos.length || !tradeGetInfos.length) return;
    setTradeLoading(true); setTradeResult(null);
    try {
      setTradeResult(await callFantasy("trade", { tradeGiveInfos, tradeGetInfos }));
    }
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

  const activeSignalTest = SIGNAL_FILTERS.find(f => f.id === signalFilter)?.test || (() => true);
  const filteredCheatSheet = cheatSheet?.filter(activeSignalTest) ?? cheatSheet;
  const cheatSheetFilterSummary = [
    positionFilter !== "ALL" ? positionFilter : null,
    signalFilter !== "ALL" ? SIGNAL_FILTERS.find(f => f.id === signalFilter)?.label : null,
  ].filter(Boolean).join(", ");

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
              ].map(({ id, label }) => (
                <button key={id} onClick={() => setFantasyMode(id)} style={{ ...tabButtonStyle({ active: fantasyMode === id, accent: NFL_ORANGE }), flex: 1, textAlign: "center" }}>{label}</button>
              ))}
            </div>

            {fantasyMode === "startSit" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <PlayerSearchInput style={inputStyle} placeholder="Player A (e.g. Justin Jefferson)" value={playerA}
                    onChangeText={setPlayerA} onSelectPlayer={setPlayerAInfo}
                    getAuthHeaders={getAuthHeaders} onEnter={runStartSit} />
                  <span style={{ color: "#444", fontWeight: 700, flexShrink: 0 }}>vs</span>
                  <PlayerSearchInput style={inputStyle} placeholder="Player B (e.g. CeeDee Lamb)" value={playerB}
                    onChangeText={setPlayerB} onSelectPlayer={setPlayerBInfo}
                    getAuthHeaders={getAuthHeaders} onEnter={runStartSit} />
                </div>
                <button style={orangeBtn(!playerA.trim() || !playerB.trim() || ssLoading)}
                  disabled={!playerA.trim() || !playerB.trim() || ssLoading}
                  onClick={runStartSit}>
                  {ssLoading ? "Analyzing…" : "Get verdict →"}
                </button>
                {ssResult && <VerdictCard result={ssResult} label="START / SIT" scoring={scoring} />}
              </div>
            )}

            {fantasyMode === "trade" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div>
                  <div style={{ fontSize: 11, color: "#555", marginBottom: 6, letterSpacing: 0.5 }}>I'M GIVING</div>
                  <PlayerMultiSearch style={inputStyle} placeholder="Search a player to add…" players={tradeGiveInfos}
                    onChange={setTradeGiveInfos} getAuthHeaders={getAuthHeaders} onEnter={runTrade} />
                </div>
                <div>
                  <div style={{ fontSize: 11, color: "#555", marginBottom: 6, letterSpacing: 0.5 }}>I'M GETTING</div>
                  <PlayerMultiSearch style={inputStyle} placeholder="Search a player to add…" players={tradeGetInfos}
                    onChange={setTradeGetInfos} getAuthHeaders={getAuthHeaders} onEnter={runTrade} />
                </div>
                <button style={orangeBtn(!tradeGiveInfos.length || !tradeGetInfos.length || tradeLoading)}
                  disabled={!tradeGiveInfos.length || !tradeGetInfos.length || tradeLoading}
                  onClick={runTrade}>
                  {tradeLoading ? "Analyzing…" : "Analyze trade →"}
                </button>
                {tradeResult && <VerdictCard result={tradeResult} label="TRADE ANALYSIS" scoring={scoring} />}
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
                <button onClick={() => setFiltersOpen(o => !o)}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
                    background: "#15171d", border: `1px solid ${filtersOpen ? NFL_ORANGE : "#242832"}`,
                    borderRadius: 10, padding: "10px 14px", color: "#fff", fontSize: 13, fontWeight: 600,
                    cursor: "pointer", width: "100%",
                  }}>
                  <span>Filters{cheatSheetFilterSummary ? ` · ${cheatSheetFilterSummary}` : ""}</span>
                  <span style={{ color: NFL_ORANGE, fontSize: 11, transform: filtersOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>▾</span>
                </button>

                {filtersOpen && (
                  <div style={{ background: "#15171d", border: "1px solid #242832", borderRadius: 12, padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
                    <div>
                      <div style={{ fontSize: 10, color: "#555", fontWeight: 700, letterSpacing: 1, marginBottom: 6 }}>POSITION</div>
                      <div style={{ display: "flex", gap: 6, overflowX: "auto" }}>
                        {["ALL", "QB", "RB", "WR", "TE"].map(pos => (
                          <button key={pos} onClick={() => setPositionFilter(pos)}
                            style={{ ...tabButtonStyle({ active: positionFilter === pos, accent: NFL_ORANGE }), flexShrink: 0, padding: "6px 14px" }}>
                            {pos}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <div style={{ fontSize: 10, color: "#555", fontWeight: 700, letterSpacing: 1, marginBottom: 6 }}>SIGNAL</div>
                      <div style={{ display: "flex", gap: 6, overflowX: "auto" }}>
                        {SIGNAL_FILTERS.map(({ id, label }) => (
                          <button key={id} onClick={() => setSignalFilter(id)}
                            style={{ ...tabButtonStyle({ active: signalFilter === id, accent: NFL_ORANGE }), flexShrink: 0, padding: "5px 12px", fontSize: 11 }}>
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

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

                {!cheatSheetLoading && !cheatSheetError && cheatSheet?.length > 0 && filteredCheatSheet?.length === 0 && (
                  <div style={{ background: "#15171d", border: "1px solid #242832", borderRadius: 14, padding: "28px 16px", textAlign: "center" }}>
                    <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>No players match this filter</div>
                    <div style={{ fontSize: 13, color: "#555", lineHeight: 1.6 }}>Try a different signal or switch back to All.</div>
                  </div>
                )}

                {!cheatSheetLoading && !cheatSheetError && filteredCheatSheet?.map(p => {
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
                          {p.adp != null && <span>ADP {p.adp.toFixed(1)}</span>}
                        </div>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end", flexShrink: 0 }}>
                        {p.adp_diff != null && Math.abs(p.adp_diff) >= ADP_SIGNAL_THRESHOLD && (() => {
                          const s = adpDiffStyle(p.adp_diff);
                          return (
                            <span style={{ fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 6, background: s.bg, color: s.color, border: `1px solid ${s.border}` }}>
                              {p.adp_diff > 0 ? `+${Math.round(p.adp_diff)} vs ADP` : `${Math.round(p.adp_diff)} vs ADP`}
                            </span>
                          );
                        })()}
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
                        {p.pace_note && (
                          <span style={{ fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 6, background: "rgba(240,180,60,0.08)", color: "#F0B43C", border: "1px solid rgba(240,180,60,0.25)" }}>
                            {p.pace_note}
                          </span>
                        )}
                        {p.playcaller_note && (
                          <span style={{ fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 6, background: "rgba(200,120,220,0.08)", color: "#C878DC", border: "1px solid rgba(200,120,220,0.25)" }}>
                            {p.playcaller_note}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
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
                            <div style={{ ...S.pitchLabel, display: "flex", alignItems: "center", gap: 5 }}>
                              <TeamLogo team={pick.awayTeam} sport="nfl" size={14} /> {pick.awayTeam?.toUpperCase()}
                            </div>
                            <div style={S.pitchName}>{pick.matchup?.away || "stats unavailable"}</div>
                          </div>
                          <div style={S.pitchVs}>VS</div>
                          <div style={{ ...S.pitchBox, textAlign: "right" }}>
                            <div style={{ ...S.pitchLabel, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 5 }}>
                              {pick.homeTeam?.toUpperCase()} <TeamLogo team={pick.homeTeam} sport="nfl" size={14} />
                            </div>
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
