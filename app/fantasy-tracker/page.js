// app/fantasy-tracker/page.js
// In-season weekly companion to the draft-time Cheat Sheet (NFLSection.js's
// "fantasy" tab): tracks a per-user watchlist through the season, comparing
// season/matchup difficulty against actual results, a manual weekly "gut
// check" rating log, and an injury/teammate-opportunity news feed. Not
// Pro-gated, not admin-gated — any logged-in user. See
// app/api/nfl/fantasy/tracker, .../gut-check, .../news.
"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";
import { tokens, tabButtonStyle, accentButtonStyle } from "../../lib/ui-theme.js";

const NFL_ORANGE = "#D9754A";
const WEEKS = Array.from({ length: 18 }, (_, i) => i + 1);

function getSupabaseClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

function difficultyLabel(score) {
  if (score == null) return { text: "—", color: tokens.color.textMuted };
  if (score > 0.25) return { text: "Easy", color: tokens.color.brand };
  if (score < -0.25) return { text: "Hard", color: tokens.color.red };
  return { text: "Neutral", color: tokens.color.textSecondary };
}

// Minimal inline typeahead over /api/search?sport=nfl — same endpoint
// NFLSection.js's PlayerSearchInput uses, reimplemented locally since that
// component isn't exported for reuse outside NFLSection.js.
function PlayerAdd({ getAuthHeaders, onAdd }) {
  const [text, setText] = useState("");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    const q = text.trim();
    if (q.length < 2) { setResults([]); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const headers = await getAuthHeaders();
        const res = await fetch(`/api/search?sport=nfl&q=${encodeURIComponent(q)}`, { headers });
        const data = await res.json();
        if (!cancelled) { setResults(data.players || []); setOpen(true); }
      } catch { /* search is best-effort */ }
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [text, getAuthHeaders]);

  useEffect(() => {
    const onClick = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <div ref={boxRef} style={{ position: "relative" }}>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onFocus={() => results.length && setOpen(true)}
        placeholder="Add a player to track (e.g. Bijan Robinson)"
        style={{ width: "100%", padding: "10px 12px", borderRadius: tokens.radius.md, background: tokens.color.surfaceRaised, border: `1px solid ${tokens.color.border}`, color: tokens.color.textPrimary, fontSize: 13 }}
      />
      {open && results.length > 0 && (
        <div style={{ position: "absolute", top: "100%", left: 0, right: 0, marginTop: 4, background: tokens.color.surface, border: `1px solid ${tokens.color.border}`, borderRadius: tokens.radius.md, zIndex: 10, overflow: "hidden" }}>
          {results.map((p) => (
            <div key={p.id} onClick={() => { onAdd(p); setText(""); setResults([]); setOpen(false); }}
              style={{ padding: "8px 12px", fontSize: 13, cursor: "pointer", color: tokens.color.textPrimary, borderBottom: `1px solid ${tokens.color.border}` }}>
              {p.name} <span style={{ color: tokens.color.textMuted }}>· {p.position} · {p.team}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function GutCheckStars({ value, onChange }) {
  return (
    <div style={{ display: "flex", gap: 2 }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} onClick={() => onChange(n)} style={{ cursor: "pointer", fontSize: 16, color: n <= (value || 0) ? tokens.color.yellow : tokens.color.border }}>★</span>
      ))}
    </div>
  );
}

function PlayerCard({ player, week, gutCheck, onRate, onRemove }) {
  const season = difficultyLabel(player.seasonDifficulty);
  const thisWeek = player.thisWeekDifficulty;
  const last4 = player.actuals.slice(-4);
  const [note, setNote] = useState(gutCheck?.note || "");

  return (
    <div style={{ background: tokens.color.surface, border: `1px solid ${tokens.color.border}`, borderRadius: tokens.radius.lg, padding: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: tokens.color.textPrimary }}>{player.name}</div>
          <div style={{ fontSize: 11, color: tokens.color.textMuted }}>{player.position} · {player.team}</div>
        </div>
        <button onClick={() => onRemove(player.espnId)} style={{ background: "transparent", border: "none", color: tokens.color.textMuted, cursor: "pointer", fontSize: 12 }}>Remove</button>
      </div>

      {player.injuryStatus && (
        <div style={{ marginTop: 8, fontSize: 11, fontWeight: 700, color: tokens.color.red }}>{player.injuryStatus.toUpperCase()}</div>
      )}

      <div style={{ display: "flex", gap: 16, marginTop: 10 }}>
        <div>
          <div style={{ fontSize: 9, color: tokens.color.textSecondary, letterSpacing: 1 }}>SEASON DIFFICULTY</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: season.color }}>{season.text}</div>
        </div>
        <div>
          <div style={{ fontSize: 9, color: tokens.color.textSecondary, letterSpacing: 1 }}>THIS WEEK{week ? ` (WK ${week})` : ""}</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: difficultyLabel(thisWeek ? DIFFICULTY_TEXT_TO_SCORE[thisWeek.difficulty] : null).color }}>
            {thisWeek ? `${thisWeek.difficulty}${thisWeek.opponent ? ` vs ${thisWeek.opponent}` : ""}` : "—"}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 9, color: tokens.color.textSecondary, letterSpacing: 1 }}>PROJECTED</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: tokens.color.textPrimary }}>{player.projectedPoints != null ? player.projectedPoints.toFixed(1) : "—"}</div>
        </div>
      </div>

      {last4.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 9, color: tokens.color.textSecondary, letterSpacing: 1, marginBottom: 4 }}>LAST {last4.length} WEEKS ACTUAL vs PROJECTED</div>
          <div style={{ display: "flex", gap: 6 }}>
            {last4.map((a) => {
              const over = player.projectedPoints != null && a.points >= player.projectedPoints;
              return (
                <div key={a.week} style={{ flex: 1, textAlign: "center", background: tokens.color.surfaceRaised, borderRadius: tokens.radius.sm, padding: "6px 4px" }}>
                  <div style={{ fontSize: 9, color: tokens.color.textMuted }}>W{a.week}</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: over ? tokens.color.brand : tokens.color.red }}>{a.points.toFixed(1)}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {player.teammateAlerts.length > 0 && (
        <div style={{ marginTop: 10, padding: 10, background: `${NFL_ORANGE}1a`, border: `1px solid ${NFL_ORANGE}`, borderRadius: tokens.radius.sm }}>
          {player.teammateAlerts.map((a, i) => (
            <div key={i} style={{ fontSize: 12, color: tokens.color.textPrimary }}>🔺 {a.note}</div>
          ))}
        </div>
      )}

      {week && (
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${tokens.color.border}` }}>
          <div style={{ fontSize: 9, color: tokens.color.textSecondary, letterSpacing: 1, marginBottom: 6 }}>GUT CHECK · WEEK {week}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <GutCheckStars value={gutCheck?.rating} onChange={(rating) => onRate(player, rating, note)} />
          </div>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => gutCheck?.rating && onRate(player, gutCheck.rating, note)}
            placeholder="Why? (optional note)"
            style={{ marginTop: 6, width: "100%", padding: "6px 10px", borderRadius: tokens.radius.sm, background: tokens.color.surfaceRaised, border: `1px solid ${tokens.color.border}`, color: tokens.color.textPrimary, fontSize: 12 }}
          />
        </div>
      )}
    </div>
  );
}

const DIFFICULTY_TEXT_TO_SCORE = { easy: 1, neutral: 0, hard: -1, bye: -1 };

export default function FantasyTracker() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("week");
  const [week, setWeek] = useState(1);
  const [data, setData] = useState(null);
  const [gutChecks, setGutChecks] = useState({}); // espnId -> {rating, note}
  const [newsItems, setNewsItems] = useState([]);
  const [seasonLog, setSeasonLog] = useState([]);

  const getAuthHeaders = useCallback(async () => {
    const supabase = getSupabaseClient();
    const { data: { session } } = await supabase.auth.getSession();
    return { Authorization: `Bearer ${session?.access_token || ""}` };
  }, []);

  useEffect(() => {
    const supabase = getSupabaseClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user || null);
      setLoading(false);
    });
  }, []);

  const loadTracker = useCallback(async () => {
    const headers = await getAuthHeaders();
    const res = await fetch(`/api/nfl/fantasy/tracker?week=${week}`, { headers });
    const d = await res.json();
    setData(d);
  }, [week, getAuthHeaders]);

  const loadGutChecks = useCallback(async () => {
    const headers = await getAuthHeaders();
    const res = await fetch("/api/nfl/fantasy/gut-check", { headers });
    const d = await res.json();
    setSeasonLog(d.entries || []);
    const byEspnId = {};
    for (const e of d.entries || []) {
      if (e.week === week) byEspnId[e.espn_id] = { rating: e.rating, note: e.note };
    }
    setGutChecks(byEspnId);
  }, [week, getAuthHeaders]);

  const loadNews = useCallback(async () => {
    const headers = await getAuthHeaders();
    const res = await fetch("/api/nfl/fantasy/news", { headers });
    const d = await res.json();
    setNewsItems(d.items || []);
  }, [getAuthHeaders]);

  useEffect(() => {
    if (!user) return;
    loadTracker();
    loadGutChecks();
  }, [user, loadTracker, loadGutChecks]);

  useEffect(() => {
    if (!user || tab !== "news") return;
    loadNews();
  }, [user, tab, loadNews]);

  const addPlayer = async (p) => {
    const headers = await getAuthHeaders();
    await fetch("/api/nfl/fantasy/tracker", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "add", espnId: p.id, name: p.name, position: p.position, team: p.team }),
    });
    loadTracker();
  };

  const removePlayer = async (espnId) => {
    const headers = await getAuthHeaders();
    await fetch("/api/nfl/fantasy/tracker", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "remove", espnId }),
    });
    loadTracker();
  };

  const rate = async (player, rating, note) => {
    setGutChecks((prev) => ({ ...prev, [player.espnId]: { rating, note } }));
    const headers = await getAuthHeaders();
    await fetch("/api/nfl/fantasy/gut-check", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ espnId: player.espnId, playerName: player.name, week, rating, note }),
    });
    loadGutChecks();
  };

  if (loading) return <div style={{ minHeight: "100vh", background: tokens.color.bg }} />;
  if (!user) return (
    <div style={{ minHeight: "100vh", background: tokens.color.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ color: tokens.color.textMuted, fontSize: 14 }}>Sign in to use the Season Tracker.</div>
    </div>
  );

  const players = data?.players || [];

  return (
    <div style={{ minHeight: "100vh", background: tokens.color.bg, color: tokens.color.textPrimary, fontFamily: tokens.font.body, padding: "20px 20px 60px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ fontFamily: tokens.font.mono, fontSize: 18, fontWeight: 700 }}>
          T<span style={{ color: tokens.color.brand }}>|</span>T <span style={{ color: tokens.color.textMuted, fontSize: 13, fontWeight: 400 }}>Season Tracker</span>
        </div>
        <a href="/app" style={{ fontSize: 12, color: tokens.color.textMuted }}>&larr; Back</a>
      </div>

      <div style={{ marginBottom: 14 }}>
        <PlayerAdd getAuthHeaders={getAuthHeaders} onAdd={addPlayer} />
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 14, overflowX: "auto" }}>
        {WEEKS.map((w) => (
          <button key={w} onClick={() => setWeek(w)}
            style={{ flexShrink: 0, padding: "5px 12px", borderRadius: tokens.radius.md, fontSize: 12, fontWeight: 600, border: `1px solid ${week === w ? NFL_ORANGE : tokens.color.border}`, background: week === w ? `${NFL_ORANGE}1a` : "transparent", color: week === w ? NFL_ORANGE : tokens.color.textSecondary, cursor: "pointer" }}>
            Wk {w}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", borderBottom: `1px solid ${tokens.color.border}`, marginBottom: 16 }}>
        {[{ id: "week", label: "This Week" }, { id: "gut", label: "Gut Check Log" }, { id: "news", label: "News" }].map(({ id, label }) => (
          <button key={id} onClick={() => setTab(id)} style={{ ...tabButtonStyle({ active: tab === id, accent: NFL_ORANGE }), flex: 1, textAlign: "center" }}>{label}</button>
        ))}
      </div>

      {tab === "week" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {players.length === 0 && <div style={{ color: tokens.color.textMuted, fontSize: 13 }}>Add players above to start tracking them week by week.</div>}
          {players.map((p) => (
            <PlayerCard key={p.espnId} player={p} week={week} gutCheck={gutChecks[p.espnId]} onRate={rate} onRemove={removePlayer} />
          ))}
        </div>
      )}

      {tab === "gut" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {seasonLog.length === 0 && <div style={{ color: tokens.color.textMuted, fontSize: 13 }}>No ratings logged yet this season.</div>}
          {seasonLog.map((e, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: `1px solid ${tokens.color.border}` }}>
              <span style={{ fontSize: 11, color: tokens.color.textMuted, minWidth: 40 }}>Wk {e.week}</span>
              <span style={{ fontSize: 13, flex: 1 }}>{e.player_name}</span>
              <GutCheckStars value={e.rating} onChange={() => {}} />
            </div>
          ))}
        </div>
      )}

      {tab === "news" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {newsItems.length === 0 && <div style={{ color: tokens.color.textMuted, fontSize: 13 }}>No recent news for your tracked players.</div>}
          {newsItems.map((item, i) => (
            <div key={i} style={{ background: tokens.color.surface, border: `1px solid ${item.opportunity ? NFL_ORANGE : tokens.color.border}`, borderRadius: tokens.radius.md, padding: 12 }}>
              {item.opportunity && <div style={{ fontSize: 10, fontWeight: 700, color: NFL_ORANGE, marginBottom: 4 }}>OPPORTUNITY</div>}
              {item.type === "injury" ? (
                <div style={{ fontSize: 13 }}>
                  <b>{item.name}</b> ({item.position}, {item.team}) — {item.oldStatus || "healthy"} → <b style={{ color: tokens.color.red }}>{item.newStatus || "healthy"}</b>
                  {item.teammateAlerts.map((a, j) => <div key={j} style={{ fontSize: 12, color: tokens.color.textSecondary, marginTop: 4 }}>{a.note}</div>)}
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{item.url ? <a href={item.url} target="_blank" rel="noreferrer" style={{ color: tokens.color.textPrimary }}>{item.headline}</a> : item.headline}</div>
                  {item.description && <div style={{ fontSize: 12, color: tokens.color.textSecondary, marginTop: 4 }}>{item.description}</div>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
