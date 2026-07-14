"use client";

// Full-screen player hub — bio, season stats, recent game log, and (MLB only)
// any active Trending Prop pick for today. Structural mirror of TeamModal.js;
// stat shapes differ by sport/position so stats render generically as
// label/value pairs rather than a fixed schema.

import { useState, useEffect } from "react";
import { ChevronLeftIcon } from "./icons.js";
import PropCard from "./PropCard.js";

const MLB_GREEN = "#2FBF71";
const NFL_ORANGE = "#D9754A";

const fmtDate = (iso) => {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

// Stat objects from MLB Stats API / ESPN carry dozens of internal fields —
// keep only ones with a real display value, in whatever order they arrived.
function statEntries(stats, max = 12) {
  if (!stats) return [];
  return Object.entries(stats)
    .filter(([, v]) => v != null && v !== "" && typeof v !== "object")
    .slice(0, max);
}

export default function PlayerModal({ open, sport, playerId, playerName, onClose, getAuthHeaders, S }) {
  const [subTab, setSubTab] = useState("overview");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const accent = sport === "nfl" ? NFL_ORANGE : MLB_GREEN;

  useEffect(() => {
    if (!open || !playerId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
    setSubTab("overview");
    (async () => {
      try {
        const authHeaders = await getAuthHeaders();
        const res = await fetch(`/api/player?sport=${sport}&id=${encodeURIComponent(playerId)}`, { headers: authHeaders });
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) { setError(json.error || "Could not load player."); return; }
        setData(json);
      } catch {
        if (!cancelled) setError("Could not load player.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, sport, playerId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div role="dialog" aria-modal="true" aria-label={`${playerName || "Player"} details`} style={{ position: "fixed", inset: 0, zIndex: 9997, background: "#0a0b0f", display: "flex", flexDirection: "column", animation: "fadeUp 0.2s ease" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 20px", borderBottom: "1px solid #242832", flexShrink: 0 }}>
        <button onClick={onClose} aria-label="Back" style={{ background: "none", border: "none", color: "#999", fontSize: 20, cursor: "pointer", padding: 0, display: "inline-flex" }}><ChevronLeftIcon size={18} /></button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{data?.name || playerName}</div>
          {data?.team && <div style={{ fontSize: 11, color: "#666", marginTop: 1 }}>{data.team}{data.position ? ` · ${data.position}` : ""}</div>}
        </div>
      </div>

      {loading ? (
        <div style={S.center}>
          <div style={S.spinner} />
          <div style={{ color: "#777", fontSize: 13, marginTop: 12 }}>Loading player…</div>
        </div>
      ) : error ? (
        <div style={{ color: "#777", fontSize: 13, textAlign: "center", padding: 40 }}>{error}</div>
      ) : (
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px 40px" }}>
          {data?.trendingPick && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#555", letterSpacing: 1.5, marginBottom: 8 }}>TRENDING PICK TODAY</div>
              <PropCard pick={data.trendingPick} S={S} />
            </div>
          )}

          <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
            {[
              { id: "overview", label: "Overview" },
              { id: "gamelog", label: "Game Log" },
            ].map(({ id, label }) => (
              <button
                key={id}
                style={{
                  ...S.tabBtn,
                  borderColor: subTab === id ? accent : "#333947",
                  color: subTab === id ? accent : "#999",
                  background: subTab === id ? `${accent}14` : "#181b22",
                }}
                onClick={() => setSubTab(id)}
              >
                {label}
              </button>
            ))}
          </div>

          {subTab === "overview" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {[
                  ["Bats", data?.bats], ["Throws", data?.throws],
                  ["Height", data?.height], ["Weight", data?.weight],
                  ["Jersey", data?.jersey], ["Status", data?.injuryStatus],
                ].filter(([, v]) => v).map(([label, val]) => (
                  <div key={label} style={{ ...S.statBox, flex: "unset", minWidth: 90 }}>
                    <div style={S.statLabel}>{label.toUpperCase()}</div>
                    <div style={S.statVal}>{val}</div>
                  </div>
                ))}
              </div>

              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#555", letterSpacing: 1.5, marginBottom: 8 }}>SEASON STATS</div>
                {statEntries(data?.seasonStats).length === 0 ? (
                  <div style={{ color: "#777", fontSize: 13, textAlign: "center", padding: 24 }}>No season stats yet.</div>
                ) : (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                    {statEntries(data?.seasonStats).map(([label, val]) => (
                      <div key={label} style={S.statBox}>
                        <div style={S.statLabel}>{label}</div>
                        <div style={S.statVal}>{String(val)}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {subTab === "gamelog" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {(data?.gameLog || []).length === 0 ? (
                <div style={{ color: "#777", fontSize: 13, textAlign: "center", padding: 24 }}>No recent games.</div>
              ) : (
                data.gameLog.map((g, i) => (
                  <div key={i} style={{ ...S.card, borderColor: "#242832" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>{g.opponent ? `${g.isHome === false ? "@" : "vs"} ${g.opponent}` : "—"}</div>
                      <div style={{ fontSize: 11, color: "#666" }}>{fmtDate(g.date)}</div>
                    </div>
                    {statEntries(g.stat, 6).length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 6 }}>
                        {statEntries(g.stat, 6).map(([label, val]) => (
                          <div key={label} style={{ fontSize: 11, color: "#999" }}>{label}: <span style={{ color: "#ddd", fontWeight: 600 }}>{String(val)}</span></div>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
