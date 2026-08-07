"use client";

// Shared game calendar — full slate of upcoming MLB/NFL games (not just the
// ones that passed the pick filter), used by both app/page.js and
// app/app/page.js. Mirrors the NFLSection.js pattern: host pages pass their
// own `S` style tokens rather than this component guessing at theme values.

import { useState, useEffect } from "react";
import TeamLogo from "./TeamLogo.js";
import { tokens, tabButtonStyle, sectionLabelStyle } from "../lib/ui-theme.js";

const MLB_GREEN = tokens.color.brand;
const NFL_ORANGE = tokens.color.orange;

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

export default function ScheduleSection({ S, getAuthHeaders, onTeamClick }) {
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
    <div style={{ padding: "16px 20px 84px" }}>
      <div style={{ display: "flex", borderBottom: `1px solid ${tokens.color.border}`, marginBottom: 16 }}>
        {[
          { id: "mlb", icon: "⚾", label: "MLB" },
          { id: "nfl", icon: "🏈", label: "NFL" },
        ].map(({ id, icon, label }) => (
          <button
            key={id}
            style={{ ...tabButtonStyle({ active: sport === id, accent: id === "nfl" ? NFL_ORANGE : MLB_GREEN }), flex: 1, textAlign: "center" }}
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
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          {byDate.map(day => (
            <div key={day.date}>
              <div style={sectionLabelStyle()}>
                <span aria-hidden="true" style={{ color: accent }}>{sport === "nfl" ? "🏈" : "⚾"}</span>
                {fmtDayLabel(day.date)}
              </div>
              <div style={{ display: "flex", flexDirection: "column" }}>
                {day.games.map((g, i) => {
                  const isFinal = g.status === "Final" || g.status?.startsWith("Final");
                  const isLive = g.status === "In Progress" || g.status === "Live";
                  const teamRow = (team, score, odds, onTop) => (
                    <button
                      type="button"
                      onClick={() => onTeamClick?.(sport, team)}
                      style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        width: "100%", background: "none", border: "none", padding: onTop ? "0 0 8px" : "8px 0 0",
                        cursor: onTeamClick ? "pointer" : "default", fontFamily: "inherit", textAlign: "left",
                      }}
                    >
                      <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                        <TeamLogo team={team} sport={sport} size={22} />
                        <span style={{ fontSize: 14, color: "#eee", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{team}</span>
                      </span>
                      <span style={{ fontFamily: tokens.font.mono, fontSize: 14, fontWeight: 700, color: (isFinal || isLive) ? "#eee" : "#999", flexShrink: 0, marginLeft: 8 }}>
                        {isFinal || isLive ? (score ?? 0) : fmtOdds(odds)}
                      </span>
                    </button>
                  );
                  return (
                    <div key={g.id} style={{ display: "flex", gap: 12, padding: "12px 0", borderTop: i > 0 ? `1px solid ${tokens.color.border}` : "none" }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        {teamRow(g.awayTeam, g.awayScore, g.awayOdds, true)}
                        {teamRow(g.homeTeam, g.homeScore, g.homeOdds, false)}
                      </div>
                      <div style={{ width: 74, flexShrink: 0, textAlign: "right", paddingTop: 2 }}>
                        {isFinal ? (
                          <span style={{ fontSize: 11, fontWeight: 700, color: "#888", letterSpacing: 0.3 }}>FINAL</span>
                        ) : isLive ? (
                          <span style={{ fontSize: 11, fontWeight: 700, color: accent, display: "inline-flex", alignItems: "center", gap: 4 }}>
                            <span style={{ width: 6, height: 6, borderRadius: "50%", background: accent, display: "inline-block" }} />
                            LIVE
                          </span>
                        ) : (
                          <span style={{ fontSize: 12, color: "#999" }}>{fmtTime(g.commenceTime)}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
