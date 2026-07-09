"use client";

// Full-screen team hub — roster, record, division standings, and recent/upcoming
// schedule for a single MLB or NFL team. Opened by clicking a team name anywhere
// in the app (see the TeamLink helper below). Shared between app/page.js and
// app/app/page.js the same way NFLSection.js and ScheduleSection.js are.

import { useState, useEffect } from "react";

const MLB_GREEN = "#00FF87";
const NFL_ORANGE = "#FF6B35";

const fmtTime = (iso) => {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};

const posOrder = ["QB", "RB", "WR", "TE", "OL", "T", "G", "C", "DL", "DE", "DT", "LB", "CB", "S", "K", "P", "SP", "RP", "C", "1B", "2B", "3B", "SS", "OF", "DH"];
function groupRoster(roster) {
  const groups = {};
  for (const p of roster) {
    const key = p.position || "Other";
    if (!groups[key]) groups[key] = [];
    groups[key].push(p);
  }
  return Object.entries(groups).sort((a, b) => {
    const ai = posOrder.indexOf(a[0]);
    const bi = posOrder.indexOf(b[0]);
    if (ai === -1 && bi === -1) return a[0].localeCompare(b[0]);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}

export default function TeamModal({ open, sport, team, onClose, getAuthHeaders, S }) {
  const [subTab, setSubTab] = useState("record");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const accent = sport === "nfl" ? NFL_ORANGE : MLB_GREEN;

  useEffect(() => {
    if (!open || !team) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
    setSubTab("record");
    (async () => {
      try {
        const authHeaders = await getAuthHeaders();
        const res = await fetch(`/api/team?sport=${sport}&team=${encodeURIComponent(team)}`, { headers: authHeaders });
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) { setError(json.error || "Could not load team."); return; }
        setData(json);
      } catch {
        if (!cancelled) setError("Could not load team.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, sport, team]);

  if (!open) return null;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9997, background: "#0a0b0f", display: "flex", flexDirection: "column", animation: "fadeUp 0.2s ease" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 20px", borderBottom: "1px solid #242832", flexShrink: 0 }}>
        <button onClick={onClose} style={{ background: "none", border: "none", color: "#999", fontSize: 20, cursor: "pointer", padding: 0 }}>←</button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{data?.name || team}</div>
          {data?.division && <div style={{ fontSize: 11, color: "#666", marginTop: 1 }}>{data.division}</div>}
        </div>
      </div>

      {loading ? (
        <div style={S.center}>
          <div style={S.spinner} />
          <div style={{ color: "#777", fontSize: 13, marginTop: 12 }}>Loading team…</div>
        </div>
      ) : error ? (
        <div style={{ color: "#777", fontSize: 13, textAlign: "center", padding: 40 }}>{error}</div>
      ) : (
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px 40px" }}>
          {data?.record && (
            <div style={{ ...S.statCard, marginBottom: 16, textAlign: "center" }}>
              <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 28, fontWeight: 700, color: accent }}>
                {data.record.wins}-{data.record.losses}
              </div>
              <div style={{ fontSize: 11, color: "#777", marginTop: 4 }}>
                {data.record.pct != null ? `${(data.record.pct * 100).toFixed(1)}% win rate` : ""}
                {data.record.streak ? ` · ${data.record.streak} streak` : ""}
              </div>
            </div>
          )}

          <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
            {[
              { id: "record", label: "Schedule" },
              { id: "standings", label: "Standings" },
              { id: "roster", label: "Roster" },
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

          {subTab === "record" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              {data?.upcomingGames?.length > 0 && (
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#555", letterSpacing: 1.5, marginBottom: 8 }}>UPCOMING</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {data.upcomingGames.map(g => (
                      <div key={g.id} style={{ ...S.card, borderColor: "#242832" }}>
                        <div style={{ fontSize: 13, fontWeight: 700 }}>{g.awayTeam} @ {g.homeTeam}</div>
                        <div style={{ fontSize: 11, color: "#666", marginTop: 3 }}>{fmtTime(g.commenceTime)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {data?.recentGames?.length > 0 && (
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#555", letterSpacing: 1.5, marginBottom: 8 }}>RECENT</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {data.recentGames.map(g => (
                      <div key={g.id} style={{ ...S.card, borderColor: "#242832" }}>
                        <div style={{ fontSize: 13, fontWeight: 700 }}>{g.awayTeam} @ {g.homeTeam}</div>
                        <div style={{ fontSize: 11, color: "#888", marginTop: 3 }}>
                          Final — {g.awayTeam?.split(" ").pop()} {g.awayScore} · {g.homeTeam?.split(" ").pop()} {g.homeScore}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {!data?.upcomingGames?.length && !data?.recentGames?.length && (
                <div style={{ color: "#777", fontSize: 13, textAlign: "center", padding: 24 }}>No games found.</div>
              )}
            </div>
          )}

          {subTab === "standings" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {(data?.standings || []).length === 0 ? (
                <div style={{ color: "#777", fontSize: 13, textAlign: "center", padding: 24 }}>Standings unavailable.</div>
              ) : (
                <>
                  <div style={{ display: "flex", padding: "0 12px", fontSize: 10, color: "#555", letterSpacing: 1, marginBottom: 4 }}>
                    <div style={{ flex: 1 }}>TEAM</div>
                    <div style={{ width: 40, textAlign: "right" }}>W</div>
                    <div style={{ width: 40, textAlign: "right" }}>L</div>
                    <div style={{ width: 60, textAlign: "right" }}>PCT</div>
                  </div>
                  {data.standings.map(row => (
                    <div key={row.team} style={{
                      display: "flex", alignItems: "center", padding: "10px 12px", borderRadius: 10,
                      background: row.isCurrentTeam ? `${accent}14` : "transparent",
                      border: row.isCurrentTeam ? `1px solid ${accent}44` : "1px solid transparent",
                    }}>
                      <div style={{ flex: 1, fontSize: 13, fontWeight: row.isCurrentTeam ? 700 : 500, color: row.isCurrentTeam ? accent : "#ddd" }}>{row.team}</div>
                      <div style={{ width: 40, textAlign: "right", fontSize: 13, fontFamily: "'JetBrains Mono',monospace" }}>{row.wins}</div>
                      <div style={{ width: 40, textAlign: "right", fontSize: 13, fontFamily: "'JetBrains Mono',monospace" }}>{row.losses}</div>
                      <div style={{ width: 60, textAlign: "right", fontSize: 12, fontFamily: "'JetBrains Mono',monospace", color: "#888" }}>
                        {row.pct != null ? row.pct.toFixed(3).replace(/^0/, "") : "—"}
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}

          {subTab === "roster" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              {(data?.roster || []).length === 0 ? (
                <div style={{ color: "#777", fontSize: 13, textAlign: "center", padding: 24 }}>Roster unavailable.</div>
              ) : (
                groupRoster(data.roster).map(([pos, players]) => (
                  <div key={pos}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "#555", letterSpacing: 1.5, marginBottom: 8 }}>{pos}</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {players.map((p, i) => (
                        <div key={`${p.name}-${i}`} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", background: "#181b22", borderRadius: 8 }}>
                          <div style={{ fontSize: 13, color: "#ddd" }}>{p.name}</div>
                          {p.number && <div style={{ fontSize: 12, color: "#666", fontFamily: "'JetBrains Mono',monospace" }}>#{p.number}</div>}
                        </div>
                      ))}
                    </div>
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

// Renders "{awayTeam} @ {homeTeam}" as two independently clickable spans that
// open the TeamModal, matching whatever text style the caller already used.
export function TeamMatchupLink({ sport, awayTeam, homeTeam, onPick, style, awayLabel, homeLabel }) {
  const linkStyle = { cursor: onPick ? "pointer" : undefined };
  const pick = (team) => (e) => { if (!onPick) return; e.stopPropagation(); onPick(sport, team); };
  return (
    <span style={style}>
      <span style={linkStyle} onClick={pick(awayTeam)}>{awayLabel ?? awayTeam}</span>
      {" @ "}
      <span style={linkStyle} onClick={pick(homeTeam)}>{homeLabel ?? homeTeam}</span>
    </span>
  );
}
