"use client";

// Shared game calendar — full slate of upcoming MLB/NFL games (not just the
// ones that passed the pick filter), used by both app/page.js and
// app/app/page.js. Mirrors the NFLSection.js pattern: host pages pass their
// own `S` style tokens rather than this component guessing at theme values.

import { useState, useEffect } from "react";

const MLB_GREEN = "#00FF87";
const NFL_ORANGE = "#FF6B35";

const fmtOdds = (o) => (o == null ? "—" : o > 0 ? `+${o}` : `${o}`);

function fmtDayLabel(dateStr) {
  const d = new Date(`${dateStr}T12:00:00`);
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const tmrw = new Date(today);
  tmrw.setDate(tmrw.getDate() + 1);
  if (dateStr === todayStr) return "Today";
  if (dateStr === tmrw.toISOString().slice(0, 10)) return "Tomorrow";
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function fmtTime(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export default function ScheduleSection({ S, getAuthHeaders }) {
  const [sport, setSport] = useState("mlb");
  const [games, setGames] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const authHeaders = await getAuthHeaders();
        const res = await fetch(`/api/schedule?sport=${sport}`, { headers: authHeaders });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) { setError(data.error || "Could not load schedule."); setGames([]); return; }
        setGames(data.games || []);
      } catch (e) {
        if (!cancelled) { setError("Could not load schedule."); setGames([]); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [sport]);

  const accent = sport === "nfl" ? NFL_ORANGE : MLB_GREEN;

  // Group games by date, preserving date order.
  const byDate = [];
  const dateIdx = {};
  for (const g of (games || [])) {
    if (!(g.date in dateIdx)) {
      dateIdx[g.date] = byDate.length;
      byDate.push({ date: g.date, games: [] });
    }
    byDate[dateIdx[g.date]].games.push(g);
  }

  return (
    <div style={{ padding: "16px 20px 40px" }}>
      <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
        {[
          { id: "mlb", icon: "⚾", label: "MLB" },
          { id: "nfl", icon: "🏈", label: "NFL" },
        ].map(({ id, icon, label }) => (
          <button
            key={id}
            style={{
              ...S.tabBtn,
              borderColor: sport === id ? accent : "#333",
              color: sport === id ? accent : "#999",
              background: sport === id ? `${accent}14` : "#111",
            }}
            onClick={() => setSport(id)}
          >
            {icon} {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={S.center}>
          <div style={S.spinner} />
          <div style={{ color: "#777", fontSize: 13, marginTop: 12 }}>Loading schedule…</div>
        </div>
      ) : error ? (
        <div style={{ color: "#777", fontSize: 13, textAlign: "center", padding: 24 }}>{error}</div>
      ) : byDate.length === 0 ? (
        <div style={{ color: "#777", fontSize: 13, textAlign: "center", padding: 24 }}>
          {sport === "nfl" ? "No games scheduled in this window — check back during the season." : "No games scheduled in this window."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {byDate.map(day => (
            <div key={day.date}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#555", letterSpacing: 1.5, marginBottom: 8 }}>
                {fmtDayLabel(day.date).toUpperCase()}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {day.games.map(g => (
                  <div key={g.id} style={{ ...S.card, borderColor: "#1a1a1a" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: "#fff" }}>
                          {g.awayTeam} @ {g.homeTeam}
                        </div>
                        <div style={{ fontSize: 11, color: "#666", marginTop: 3 }}>
                          {g.status === "Final" || g.status?.startsWith("Final") ? (
                            <span style={{ color: "#888" }}>
                              Final — {g.awayTeam?.split(" ").pop()} {g.awayScore} · {g.homeTeam?.split(" ").pop()} {g.homeScore}
                            </span>
                          ) : g.status === "In Progress" || g.status === "Live" ? (
                            <span style={{ color: accent }}>🔴 Live — {g.awayScore ?? 0}-{g.homeScore ?? 0}</span>
                          ) : (
                            <>{fmtTime(g.commenceTime)}{g.venue ? ` · ${g.venue}` : ""}</>
                          )}
                        </div>
                      </div>
                      {(g.homeOdds != null || g.awayOdds != null) && (
                        <div style={{ textAlign: "right", fontFamily: "'JetBrains Mono',monospace", fontSize: 12 }}>
                          <div style={{ color: "#999" }}>{fmtOdds(g.awayOdds)}</div>
                          <div style={{ color: "#999", marginTop: 2 }}>{fmtOdds(g.homeOdds)}</div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
