"use client";

// Browsable/searchable player directory — search-as-you-type across every
// MLB or NFL player (same Supabase-backed index app/api/search/route.js
// already uses for the global search overlay), tap through to PlayerModal.
// Same shape as TeamsSection.js/ScheduleSection.js: a self-contained
// component with its own sport toggle.

import { useState, useEffect, useRef } from "react";
import TeamLogo from "./TeamLogo.js";
import { tokens, tabButtonStyle } from "../lib/ui-theme.js";

const MLB_GREEN = tokens.color.brand;
const NFL_ORANGE = tokens.color.orange;

export default function PlayersSection({ S, getAuthHeaders, onPlayerClick }) {
  const [sport, setSport] = useState("mlb");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef(null);

  useEffect(() => {
    setQuery("");
    setResults(null);
  }, [sport]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (q.length < 2) { setResults(null); setLoading(false); return; }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const authHeaders = await getAuthHeaders();
        const res = await fetch(`/api/search?sport=${sport}&q=${encodeURIComponent(q)}`, { headers: authHeaders });
        const data = await res.json();
        setResults(data.players || []);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(debounceRef.current);
  }, [query, sport]);

  const accent = sport === "nfl" ? NFL_ORANGE : MLB_GREEN;

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

      <input
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder={`Search ${sport === "nfl" ? "NFL" : "MLB"} players…`}
        style={{ ...tokens.input, marginBottom: 16 }}
      />

      {query.trim().length < 2 ? (
        <div style={{ color: "#555", fontSize: 13, textAlign: "center", padding: 32 }}>
          Type at least 2 letters to search {sport === "nfl" ? "NFL" : "MLB"} players.
        </div>
      ) : loading ? (
        <div style={S.center}>
          <div style={S.spinner} />
        </div>
      ) : (results || []).length === 0 ? (
        <div style={{ color: "#777", fontSize: 13, textAlign: "center", padding: 24 }}>No players found.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {results.map((p, i) => (
            <button
              key={p.id}
              onClick={() => onPlayerClick(sport, p.id, p.name)}
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", textAlign: "left", cursor: "pointer", fontFamily: "inherit", background: "none", border: "none", padding: "10px 0", borderTop: i > 0 ? `1px solid ${tokens.color.border}` : "none" }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                <TeamLogo team={p.team} sport={sport} size={24} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#eee", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                  <div style={{ fontSize: 11, color: "#666", marginTop: 2 }}>
                    {p.team}{p.position ? ` · ${p.position}` : ""}
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                {p.injuryStatus && (
                  <span style={{ fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 999, background: "rgba(217,100,92,0.1)", color: "#D9645C", border: "1px solid rgba(217,100,92,0.3)" }}>
                    {p.injuryStatus}
                  </span>
                )}
                <span style={{ color: accent, fontSize: 15 }}>›</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
