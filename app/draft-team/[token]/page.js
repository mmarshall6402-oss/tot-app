"use client";

// Public, read-only view of a saved Draft Assistant team
// (app/api/nfl/fantasy/draft-teams/shared, generated from "Share" in
// components/NFLSection.js's Draft Assistant). No login required — the
// share_token in the URL is the whole point, same posture as a Google Doc
// "anyone with the link" share.
import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { tokens } from "../../../lib/ui-theme.js";

const POSITION_ACCENT = { QB: "#7C8CFF", RB: "#2FBF71", WR: "#D9754A", TE: "#C878DC" };

function LineupRow({ label, position, player }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, background: tokens.color.surfaceRaised, border: `1px solid ${tokens.color.border}`, borderRadius: 8, padding: "10px 12px" }}>
      <div style={{ width: 42, flexShrink: 0, fontSize: 11, fontWeight: 800, color: POSITION_ACCENT[position] || tokens.color.textSecondary }}>{label}</div>
      {player ? (
        <>
          <div style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 700, color: tokens.color.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{player.name}</div>
          <div style={{ fontSize: 11, color: tokens.color.textMuted, flexShrink: 0 }}>{player.team || "FA"}</div>
        </>
      ) : (
        <div style={{ flex: 1, fontSize: 12, color: tokens.color.textMuted, fontStyle: "italic" }}>Empty</div>
      )}
    </div>
  );
}

export default function SharedDraftTeamPage() {
  const { token } = useParams();
  const [state, setState] = useState({ loading: true, error: null, team: null });

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/nfl/fantasy/draft-teams/shared?token=${encodeURIComponent(token)}`);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(data.error || "Could not load this team");
        setState({ loading: false, error: null, team: data });
      } catch (e) {
        if (!cancelled) setState({ loading: false, error: e.message, team: null });
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  return (
    <div style={{ minHeight: "100vh", background: tokens.color.bg, color: tokens.color.textPrimary, fontFamily: tokens.font.body, padding: "40px 20px 60px", maxWidth: 480, margin: "0 auto" }}>
      <Link href="/" style={{ fontSize: 13, color: tokens.color.textMuted, textDecoration: "none" }}>← This or That</Link>

      {state.loading && (
        <div style={{ textAlign: "center", padding: "80px 0", color: tokens.color.textMuted, fontSize: 13 }}>Loading team…</div>
      )}

      {!state.loading && state.error && (
        <div style={{ textAlign: "center", padding: "80px 0" }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Can&apos;t load this team</div>
          <div style={{ fontSize: 13, color: tokens.color.textMuted }}>{state.error}</div>
        </div>
      )}

      {!state.loading && state.team && (
        <>
          <h1 style={{ fontFamily: tokens.font.display, fontSize: 26, fontWeight: 600, margin: "22px 0 2px" }}>{state.team.name}</h1>
          <div style={{ fontSize: 12, color: tokens.color.textMuted, marginBottom: 22 }}>
            {state.team.scoringFormat?.toUpperCase().replace("_", " ")} · Updated {new Date(state.team.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {state.team.starters.map(({ slot, position, player }) => (
              <LineupRow key={slot} label={slot} position={position} player={player} />
            ))}
          </div>

          {state.team.bench.length > 0 && (
            <>
              <div style={{ fontSize: 10, color: tokens.color.textMuted, fontWeight: 700, letterSpacing: 1, margin: "20px 0 8px" }}>BENCH</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {state.team.bench.map((p) => (
                  <LineupRow key={p.player_id} label={p.position} position={p.position} player={p} />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
