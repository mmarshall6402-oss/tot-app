// app/admin/players/page.js
// NFL player lookup + hand-tuning console. Search any rostered NFL player,
// view their bio/season stats/recent game log (same data source as the
// public PlayerModal), and override the fantasy model's projected/floor/
// ceiling season points with sliders. Saved overrides live in
// nfl_player_overrides (sql/017_nfl_player_overrides.sql) and are folded in
// last — after every other adjustment — by lib/nfl-fantasy/player-override.js
// on the next nfl-fantasy-rankings cron run (or immediately via the
// "Rebuild Rankings Now" button below, same /api/admin/regen dispatch the
// main admin dashboard uses for player-index/props).
// Protected: only accessible if logged in as admin email.
"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { createClient } from "@supabase/supabase-js";

const ADMIN_EMAILS = (process.env.NEXT_PUBLIC_ADMIN_EMAILS || process.env.NEXT_PUBLIC_ADMIN_EMAIL || "")
  .split(",").map(e => e.trim().toLowerCase()).filter(Boolean);

const css = `*{box-sizing:border-box;margin:0;padding:0;}body{background:#000;color:#fff;font-family:'Space Grotesk',sans-serif;}input,textarea{outline:none;}button{cursor:pointer;font-family:inherit;}`;
const S = {
  page: { minHeight: "100vh", background: "#000", padding: "20px 16px", maxWidth: 720, margin: "0 auto" },
  card: { background: "#0a0a0a", border: "1px solid #1a1a1a", borderRadius: 14, padding: "14px 16px", marginBottom: 12 },
  lbl: { fontSize: 10, fontWeight: 700, color: "#555", letterSpacing: 2, marginBottom: 8, display: "block" },
  input: { background: "#111", border: "1px solid #222", borderRadius: 8, padding: "10px 12px", color: "#fff", fontSize: 13, width: "100%" },
  mono: { fontFamily: "'JetBrains Mono',monospace" },
  btn: { border: "1px solid #333", borderRadius: 8, padding: "9px 14px", fontSize: 12, fontWeight: 700, background: "#111", color: "#fff", cursor: "pointer" },
  statBox: { background: "#111", border: "1px solid #222", borderRadius: 8, padding: "8px 10px", minWidth: 80 },
  statLabel: { fontSize: 9, color: "#555", letterSpacing: 1, marginBottom: 2 },
  statVal: { fontSize: 13, fontWeight: 700, color: "#ddd" },
};

function statEntries(stats, max = 12) {
  if (!stats) return [];
  return Object.entries(stats).filter(([, v]) => v != null && v !== "" && typeof v !== "object").slice(0, max);
}

function useDebounced(value, delay) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

// Bound-and-synced range + number input pair — this is the "slider" the
// admin actually drags, with a text box alongside for typing an exact value
// (a bare slider can't hit e.g. 187.3 projected points reliably).
function StatSlider({ label, value, onChange, max = 450 }) {
  const displayVal = value ?? 0;
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
        <span style={{ fontSize: 12, color: "#888" }}>{label}</span>
        <input
          type="number" step="0.1" value={displayVal}
          onChange={e => onChange(e.target.value === "" ? 0 : parseFloat(e.target.value))}
          style={{ ...S.mono, width: 70, background: "#111", border: "1px solid #222", borderRadius: 6, padding: "4px 8px", color: "#00FF87", fontSize: 13, textAlign: "right" }}
        />
      </div>
      <input
        type="range" min={0} max={max} step={0.5} value={Math.min(max, Math.max(0, displayVal))}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ width: "100%", accentColor: "#00FF87" }}
      />
    </div>
  );
}

export default function PlayerTuningConsole() {
  const [authorized, setAuthorized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState("");

  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounced(query, 300);
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);

  const [selected, setSelected] = useState(null); // { id, name, team, position }
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [model, setModel] = useState(null);
  const [existingOverride, setExistingOverride] = useState(null);

  const [meanPoints, setMeanPoints] = useState(0);
  const [floorPoints, setFloorPoints] = useState(0);
  const [ceilingPoints, setCeilingPoints] = useState(0);
  const [note, setNote] = useState("");
  const [saveState, setSaveState] = useState(null); // "loading" | "ok" | "err"
  const [clearState, setClearState] = useState(null);
  const [rebuildState, setRebuildState] = useState(null);

  const [tunedList, setTunedList] = useState([]);
  const authHeaders = useRef({});

  useEffect(() => {
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    supabase.auth.getSession().then(({ data: { session } }) => {
      const u = session?.user;
      if (u?.email && ADMIN_EMAILS.includes(u.email.toLowerCase())) {
        setAuthorized(true);
        setToken(session.access_token);
        authHeaders.current = { Authorization: `Bearer ${session.access_token}` };
      }
      setLoading(false);
    });
  }, []);

  const loadTunedList = useCallback(async (tok) => {
    try {
      const res = await fetch("/api/admin/player-overrides", { headers: { Authorization: `Bearer ${tok}` } });
      const data = await res.json();
      setTunedList(data.overrides || []);
    } catch { /* best-effort */ }
  }, []);

  useEffect(() => { if (authorized && token) loadTunedList(token); }, [authorized, token, loadTunedList]);

  useEffect(() => {
    if (!authorized || debouncedQuery.trim().length < 2) { setResults([]); return; }
    let cancelled = false;
    setSearching(true);
    fetch(`/api/search?q=${encodeURIComponent(debouncedQuery)}&sport=nfl`, { headers: authHeaders.current })
      .then(r => r.json())
      .then(d => { if (!cancelled) setResults(d.players || []); })
      .catch(() => { if (!cancelled) setResults([]); })
      .finally(() => { if (!cancelled) setSearching(false); });
    return () => { cancelled = true; };
  }, [authorized, debouncedQuery]);

  const selectPlayer = useCallback(async (player) => {
    setSelected(player);
    setResults([]);
    setQuery("");
    setDetail(null);
    setModel(null);
    setExistingOverride(null);
    setSaveState(null);
    setClearState(null);
    setDetailLoading(true);
    try {
      const [playerRes, overrideRes] = await Promise.all([
        fetch(`/api/player?sport=nfl&id=${encodeURIComponent(player.id)}`, { headers: authHeaders.current }).then(r => r.json()),
        fetch(`/api/admin/player-overrides?playerId=${encodeURIComponent(player.id)}`, { headers: authHeaders.current }).then(r => r.json()),
      ]);
      setDetail(playerRes?.error ? null : playerRes);
      setModel(overrideRes?.model || null);
      setExistingOverride(overrideRes?.override || null);

      const seedMean = overrideRes?.override?.mean_points ?? overrideRes?.model?.projected_points ?? 0;
      const seedFloor = overrideRes?.override?.floor_points ?? overrideRes?.model?.floor_points ?? 0;
      const seedCeiling = overrideRes?.override?.ceiling_points ?? overrideRes?.model?.ceiling_points ?? 0;
      setMeanPoints(round1(seedMean));
      setFloorPoints(round1(seedFloor));
      setCeilingPoints(round1(seedCeiling));
      setNote(overrideRes?.override?.note || "");
    } catch {
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  function round1(n) { return Math.round((n || 0) * 10) / 10; }

  async function saveOverride() {
    if (!selected) return;
    setSaveState("loading");
    try {
      const res = await fetch("/api/admin/player-overrides", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders.current },
        body: JSON.stringify({
          action: "set",
          playerId: selected.id,
          name: detail?.name || selected.name,
          position: detail?.position || selected.position,
          meanPoints, floorPoints, ceilingPoints, note,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Save failed");
      setExistingOverride(d.override);
      setSaveState("ok");
      loadTunedList(token);
    } catch {
      setSaveState("err");
    }
    setTimeout(() => setSaveState(null), 3000);
  }

  async function clearOverride(playerId) {
    setClearState("loading");
    try {
      const res = await fetch("/api/admin/player-overrides", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders.current },
        body: JSON.stringify({ action: "clear", playerId }),
      });
      if (!res.ok) throw new Error("Clear failed");
      if (selected?.id === playerId) {
        setExistingOverride(null);
        setMeanPoints(round1(model?.projected_points || 0));
        setFloorPoints(round1(model?.floor_points || 0));
        setCeilingPoints(round1(model?.ceiling_points || 0));
        setNote("");
      }
      setClearState("ok");
      loadTunedList(token);
    } catch {
      setClearState("err");
    }
    setTimeout(() => setClearState(null), 3000);
  }

  async function rebuildRankings() {
    setRebuildState("loading");
    try {
      const res = await fetch("/api/admin/regen", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders.current },
        body: JSON.stringify({ type: "nfl-fantasy-rankings" }),
      });
      setRebuildState(res.ok ? "ok" : "err");
    } catch {
      setRebuildState("err");
    }
    setTimeout(() => setRebuildState(null), 8000);
  }

  if (loading) return <div style={{ minHeight: "100vh", background: "#000" }} />;
  if (!authorized) return (
    <div style={{ minHeight: "100vh", background: "#000", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ color: "#444", fontSize: 14 }}>Unauthorized</div>
    </div>
  );

  return (
    <div style={S.page}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&family=JetBrains+Mono:wght@400;700&display=swap');${css}`}</style>

      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>T<span style={{ color: "#00FF87" }}>|</span>T Player Tuning</div>
      <a href="/admin" style={{ fontSize: 11, color: "#444" }}>&larr; Admin</a>

      <div style={{ marginTop: 20 }}>
        <span style={S.lbl}>SEARCH ANY NFL PLAYER</span>
        <input
          style={S.input} placeholder="Name (e.g. Josh Allen)…" value={query}
          onChange={e => setQuery(e.target.value)}
        />
        {searching && <div style={{ fontSize: 11, color: "#444", marginTop: 8 }}>Searching…</div>}
        {results.length > 0 && (
          <div style={{ ...S.card, marginTop: 8, padding: 6 }}>
            {results.map(p => (
              <button key={p.id} onClick={() => selectPlayer(p)}
                style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", padding: "8px 10px", borderRadius: 8, color: "#fff" }}>
                <span style={{ fontWeight: 700, fontSize: 13 }}>{p.name}</span>
                <span style={{ fontSize: 11, color: "#666", marginLeft: 8 }}>{p.position} · {p.team || "FA"}</span>
                {p.injuryStatus && <span style={{ fontSize: 10, color: "#FF4D4D", marginLeft: 8 }}>{p.injuryStatus}</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {selected && (
        <div style={{ marginTop: 20 }}>
          {detailLoading && <div style={{ color: "#555", fontSize: 13, padding: "16px 0" }}>Loading {selected.name}…</div>}

          {!detailLoading && (
            <>
              <span style={S.lbl}>BIO</span>
              <div style={{ ...S.card, display: "flex", flexWrap: "wrap", gap: 8 }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700 }}>{detail?.name || selected.name}</div>
                  <div style={{ fontSize: 11, color: "#666" }}>{detail?.team || selected.team} · {detail?.position || selected.position}</div>
                </div>
              </div>
              {statEntries({
                Age: detail?.age, Height: detail?.height, Weight: detail?.weight,
                College: detail?.college, Exp: detail?.experience, Status: detail?.injuryStatus,
              }).length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                  {statEntries({
                    Age: detail?.age, Height: detail?.height, Weight: detail?.weight,
                    College: detail?.college, Exp: detail?.experience, Status: detail?.injuryStatus,
                  }).map(([label, val]) => (
                    <div key={label} style={S.statBox}>
                      <div style={S.statLabel}>{label.toUpperCase()}</div>
                      <div style={S.statVal}>{String(val)}</div>
                    </div>
                  ))}
                </div>
              )}

              <span style={S.lbl}>SEASON STATS</span>
              <div style={{ ...S.card, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                {statEntries(detail?.seasonStats).length === 0 ? (
                  <div style={{ color: "#555", fontSize: 12, gridColumn: "1 / -1" }}>No season stats available.</div>
                ) : statEntries(detail?.seasonStats).map(([label, val]) => (
                  <div key={label} style={S.statBox}>
                    <div style={S.statLabel}>{label}</div>
                    <div style={S.statVal}>{String(val)}</div>
                  </div>
                ))}
              </div>

              {(detail?.gameLog || []).length > 0 && (
                <>
                  <span style={S.lbl}>RECENT GAME LOG</span>
                  <div style={{ ...S.card, display: "flex", flexDirection: "column", gap: 8 }}>
                    {detail.gameLog.slice(0, 5).map((g, i) => (
                      <div key={i} style={{ borderBottom: i < 4 ? "1px solid #1a1a1a" : "none", paddingBottom: 8 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                          <span style={{ fontWeight: 700 }}>{g.opponent ? `${g.isHome === false ? "@" : "vs"} ${g.opponent}` : "—"}</span>
                          <span style={{ color: "#555" }}>{g.date ? new Date(g.date).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : ""}</span>
                        </div>
                        {statEntries(g.stat, 6).length > 0 && (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
                            {statEntries(g.stat, 6).map(([label, val]) => (
                              <span key={label} style={{ fontSize: 10, color: "#888" }}>{label}: <span style={{ color: "#ddd" }}>{String(val)}</span></span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}

              <span style={S.lbl}>FANTASY MODEL PROJECTION (PPR)</span>
              <div style={{ ...S.card, display: "flex", gap: 8, marginBottom: 12 }}>
                {model ? (
                  <>
                    <div style={S.statBox}><div style={S.statLabel}>PROJ</div><div style={S.statVal}>{model.projected_points?.toFixed(1)}</div></div>
                    <div style={S.statBox}><div style={S.statLabel}>FLOOR</div><div style={S.statVal}>{model.floor_points?.toFixed(1)}</div></div>
                    <div style={S.statBox}><div style={S.statLabel}>CEIL</div><div style={S.statVal}>{model.ceiling_points?.toFixed(1)}</div></div>
                    <div style={S.statBox}><div style={S.statLabel}>TIER</div><div style={S.statVal}>{model.tier ?? "—"}</div></div>
                  </>
                ) : (
                  <div style={{ color: "#555", fontSize: 12 }}>No rankings row yet for this player — sliders below start from 0.</div>
                )}
              </div>

              <span style={S.lbl}>
                HAND-TUNE PROJECTION {existingOverride && <span style={{ color: "#00FF87" }}>· CURRENTLY OVERRIDDEN</span>}
              </span>
              <div style={{ ...S.card }}>
                <div style={{ fontSize: 11, color: "#555", marginBottom: 14, lineHeight: 1.6 }}>
                  These three numbers replace the model&apos;s season-total projection outright — they win over every
                  computed adjustment (aging, injury, personnel, pace, playcaller) for this player once rankings rebuild.
                </div>
                <StatSlider label="Projected Points (season)" value={meanPoints} onChange={setMeanPoints} />
                <StatSlider label="Floor Points" value={floorPoints} onChange={setFloorPoints} />
                <StatSlider label="Ceiling Points" value={ceilingPoints} onChange={setCeilingPoints} />

                <span style={{ ...S.lbl, marginTop: 4 }}>NOTE (shown as a badge on the public Cheat Sheet)</span>
                <textarea
                  value={note} onChange={e => setNote(e.target.value)} rows={2}
                  placeholder="e.g. Coaching staff confirmed bell-cow role in camp"
                  style={{ ...S.input, resize: "vertical", fontFamily: "inherit" }}
                />

                <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
                  <button onClick={saveOverride} disabled={saveState === "loading"}
                    style={{ ...S.btn, flex: 1, background: "#00FF87", color: "#000", border: "none", fontWeight: 800 }}>
                    {saveState === "loading" ? "Saving…" : saveState === "ok" ? "✓ Saved" : saveState === "err" ? "✗ Failed" : "Save Override"}
                  </button>
                  {existingOverride && (
                    <button onClick={() => clearOverride(selected.id)} disabled={clearState === "loading"}
                      style={{ ...S.btn, color: "#FF4D4D", border: "1px solid rgba(255,77,77,0.2)", background: "rgba(255,77,77,0.06)" }}>
                      {clearState === "loading" ? "Clearing…" : clearState === "ok" ? "✓ Cleared" : "Clear Override"}
                    </button>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      <div style={{ marginTop: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <span style={S.lbl}>CURRENTLY TUNED PLAYERS ({tunedList.length})</span>
          <button onClick={rebuildRankings} disabled={rebuildState === "loading"}
            style={{ ...S.btn, fontSize: 11, padding: "6px 10px" }}>
            {rebuildState === "loading" ? "⏳ Rebuilding…" : rebuildState === "ok" ? "✓ Rebuilt" : rebuildState === "err" ? "✗ Failed" : "⚡ Rebuild Rankings Now"}
          </button>
        </div>
        {tunedList.length === 0 && <div style={{ color: "#555", fontSize: 13, padding: "16px 0" }}>No hand-tuned players yet.</div>}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {tunedList.map(o => (
            <div key={o.player_id} style={{ ...S.card, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{o.name} <span style={{ fontSize: 11, color: "#666", fontWeight: 400 }}>{o.position}</span></div>
                <div style={{ ...S.mono, fontSize: 11, color: "#00FF87", marginTop: 2 }}>
                  {o.mean_points != null ? `Proj ${o.mean_points}` : ""}{o.floor_points != null ? ` · Floor ${o.floor_points}` : ""}{o.ceiling_points != null ? ` · Ceil ${o.ceiling_points}` : ""}
                </div>
                {o.note && <div style={{ fontSize: 11, color: "#555", marginTop: 2 }}>{o.note}</div>}
              </div>
              <button onClick={() => clearOverride(o.player_id)}
                style={{ ...S.btn, color: "#FF4D4D", border: "1px solid rgba(255,77,77,0.2)", background: "rgba(255,77,77,0.06)", padding: "6px 12px", fontSize: 11 }}>
                Clear
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
