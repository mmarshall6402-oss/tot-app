"use client";

// Browsable/searchable team directory — every MLB or NFL team, grouped by
// division, tap through to TeamModal. Same shape as ScheduleSection.js: a
// self-contained component with its own sport toggle, so it's reachable from
// the subnav regardless of which top-level sport tab is active.

import { useState, useEffect } from "react";
import TeamLogo from "./TeamLogo.js";
import { tokens, tabButtonStyle, sectionLabelStyle } from "../lib/ui-theme.js";

const MLB_GREEN = tokens.color.brand;
const NFL_ORANGE = tokens.color.orange;

export default function TeamsSection({ S, getAuthHeaders, onTeamClick }) {
  const [sport, setSport] = useState("mlb");
  const [teams, setTeams] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const authHeaders = await getAuthHeaders();
        const res = await fetch(`/api/teams?sport=${sport}`, { headers: authHeaders });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) { setError(data.error || "Could not load teams."); setTeams([]); return; }
        setTeams(data.teams || []);
      } catch {
        if (!cancelled) { setError("Could not load teams."); setTeams([]); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [sport]);

  const accent = sport === "nfl" ? NFL_ORANGE : MLB_GREEN;

  const q = query.trim().toLowerCase();
  const filtered = (teams || []).filter(t =>
    !q || t.name.toLowerCase().includes(q) || (t.division || "").toLowerCase().includes(q)
  );

  const groups = [];
  const groupIdx = {};
  for (const t of filtered) {
    const key = t.division || "All Teams";
    if (!(key in groupIdx)) { groupIdx[key] = groups.length; groups.push({ division: key, teams: [] }); }
    groups[groupIdx[key]].teams.push(t);
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
            onClick={() => { setSport(id); setQuery(""); }}
          >
            {icon} {label}
          </button>
        ))}
      </div>

      <input
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder={`Search ${sport === "nfl" ? "NFL" : "MLB"} teams…`}
        style={{ ...tokens.input, marginBottom: 16 }}
      />

      {loading ? (
        <div style={S.center}>
          <div style={S.spinner} />
          <div style={{ color: "#777", fontSize: 13, marginTop: 12 }}>Loading teams…</div>
        </div>
      ) : error ? (
        <div style={{ color: "#777", fontSize: 13, textAlign: "center", padding: 24 }}>{error}</div>
      ) : filtered.length === 0 ? (
        <div style={{ color: "#777", fontSize: 13, textAlign: "center", padding: 24 }}>No teams found.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {groups.map(({ division, teams: list }) => (
            <div key={division}>
              <div style={sectionLabelStyle()}>
                <span aria-hidden="true" style={{ color: accent }}>{sport === "nfl" ? "🏈" : "⚾"}</span>
                {division}
              </div>
              <div style={{ display: "flex", flexDirection: "column" }}>
                {list.map((t, i) => (
                  <button
                    key={t.name}
                    onClick={() => onTeamClick(sport, t.name)}
                    style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", textAlign: "left", cursor: "pointer", fontFamily: "inherit", background: "none", border: "none", padding: "10px 0", borderTop: i > 0 ? `1px solid ${tokens.color.border}` : "none" }}
                  >
                    <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                      <TeamLogo team={t.name} sport={sport} size={26} />
                      <span style={{ fontSize: 14, fontWeight: 600, color: "#eee", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name}</span>
                    </span>
                    <span style={{ color: accent, fontSize: 15, flexShrink: 0 }}>›</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
