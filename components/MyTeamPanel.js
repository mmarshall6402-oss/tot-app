"use client";

// "My Team" — links a Sleeper account (username lookup, no OAuth needed),
// lets the user pick which of their Sleeper leagues to sync, then shows
// that league's roster (enriched with our own projections/tiers) and, once
// a draft is underway, a live-ish picks feed with a value read against our
// rankings. This is the sync layer the rest of the fantasy tab has been
// missing — everything else in NFLSection.js works from typed-in player
// names; this is the first place the app knows the user's actual team.
import { useState, useEffect, useCallback } from "react";
import { tokens, tabButtonStyle } from "../lib/ui-theme.js";
import PlayerHeadshot from "./PlayerHeadshot.js";
import { nflHeadshotUrl } from "../lib/nfl-roster.js";

const NFL_ORANGE = "#D9754A";
const FANTASY_POSITIONS = ["QB", "RB", "WR", "TE"];
const t = tokens;

const cardStyle = { background: t.color.surface, border: `1px solid ${t.color.border}`, borderRadius: 14, padding: 16 };
const inputStyle = {
  flex: 1, background: t.color.surfaceRaised, border: `1px solid ${t.color.border}`, borderRadius: 8,
  padding: "10px 12px", color: t.color.textPrimary, fontSize: 14, fontFamily: t.font.body, outline: "none",
};
const btnStyle = (disabled) => ({
  background: disabled ? t.color.surface : NFL_ORANGE, color: disabled ? t.color.textMuted : "#0b0c10",
  border: "none", borderRadius: 8, padding: "10px 16px", fontWeight: 700, fontSize: 13,
  cursor: disabled ? "default" : "pointer", transition: t.transition, whiteSpace: "nowrap",
});

function PlayerRow({ p }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: `1px solid ${t.color.border}` }}>
      <PlayerHeadshot src={nflHeadshotUrl(p.espnId)} name={p.name} size={34} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: t.color.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
        <div style={{ fontSize: 11, color: t.color.textMuted }}>
          {p.position || "—"} · {p.team || "FA"}
          {p.injuryStatus ? ` · ${p.injuryStatus}` : ""}
        </div>
      </div>
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: t.color.textPrimary, fontFamily: t.font.mono }}>
          {p.projectedPoints != null ? p.projectedPoints.toFixed(1) : "—"}
        </div>
        <div style={{ fontSize: 10, color: t.color.textMuted }}>
          {p.rankOverall != null ? `#${p.rankOverall} ovr` : "unranked"}{p.tier != null ? ` · T${p.tier}` : ""}
        </div>
      </div>
    </div>
  );
}

function DraftPickRow({ pick }) {
  const value = pick.valueDelta;
  const valueColor = value == null ? t.color.textMuted : value >= 15 ? t.color.brand : value <= -15 ? t.color.red : t.color.textMuted;
  const valueLabel = value == null ? "" : value >= 15 ? `+${value} steal` : value <= -15 ? `${value} reach` : `${value >= 0 ? "+" : ""}${value}`;
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 8,
      background: pick.isMine ? `${NFL_ORANGE}14` : "transparent",
      border: pick.isMine ? `1px solid ${NFL_ORANGE}55` : "1px solid transparent",
    }}>
      <div style={{ width: 32, textAlign: "center", fontSize: 11, fontWeight: 700, color: t.color.textMuted, fontFamily: t.font.mono, flexShrink: 0 }}>
        {pick.pickNo}
      </div>
      <PlayerHeadshot src={nflHeadshotUrl(pick.espnId)} name={pick.name} size={30} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: t.color.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pick.name}</div>
        <div style={{ fontSize: 10.5, color: t.color.textMuted }}>
          {pick.position || "—"} · {pick.team || "FA"} · {pick.pickedBy || "—"}
        </div>
      </div>
      {value != null && (
        <div style={{ fontSize: 11, fontWeight: 700, color: valueColor, flexShrink: 0, fontFamily: t.font.mono }}>{valueLabel}</div>
      )}
    </div>
  );
}

function BestAvailableRow({ p }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: `1px solid ${t.color.border}` }}>
      <div style={{ width: 24, textAlign: "center", fontSize: 11, fontWeight: 700, color: t.color.textMuted, fontFamily: t.font.mono, flexShrink: 0 }}>
        {p.rank_overall != null ? p.rank_overall : "—"}
      </div>
      <PlayerHeadshot src={nflHeadshotUrl(p.espn_id)} name={p.name} size={30} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: t.color.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
        <div style={{ fontSize: 10.5, color: t.color.textMuted }}>{p.position || "—"} · {p.team || "FA"}{p.tier != null ? ` · Tier ${p.tier}` : ""}</div>
      </div>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: t.color.textPrimary, fontFamily: t.font.mono, flexShrink: 0 }}>
        {p.projected_points != null ? p.projected_points.toFixed(1) : "—"}
      </div>
    </div>
  );
}

function TeamNeeds({ needs }) {
  if (!needs?.length) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
      {needs.map((n) => {
        const short = n.drafted != null && n.drafted < n.slots;
        return (
          <span key={n.position} style={{
            fontSize: 10.5, fontWeight: 700, padding: "3px 8px", borderRadius: 999,
            background: short ? `${NFL_ORANGE}1a` : t.color.surfaceRaised,
            color: short ? NFL_ORANGE : t.color.textMuted,
            border: `1px solid ${short ? NFL_ORANGE + "55" : t.color.border}`,
          }}>
            {n.position} {n.drafted != null ? `${n.drafted}/${n.slots}` : `×${n.slots}`}
          </span>
        );
      })}
    </div>
  );
}

export default function MyTeamPanel({ getAuthHeaders }) {
  const [link, setLink] = useState(undefined); // undefined = loading, null = not linked
  const [linkError, setLinkError] = useState(null);
  const [username, setUsername] = useState("");
  const [linking, setLinking] = useState(false);

  const [leagues, setLeagues] = useState(null);
  const [leaguesLoading, setLeaguesLoading] = useState(false);
  const [leaguesError, setLeaguesError] = useState(null);
  const [selecting, setSelecting] = useState(null);

  const [activeLeague, setActiveLeague] = useState(null); // { leagueId, name }
  const [view, setView] = useState("roster"); // roster | draft
  const [roster, setRoster] = useState(null);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterError, setRosterError] = useState(null);
  const [draft, setDraft] = useState(null);
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftError, setDraftError] = useState(null);
  const [draftTab, setDraftTab] = useState("board"); // board | available
  const [bestAvailPos, setBestAvailPos] = useState("ALL");

  const authedFetch = useCallback(async (url, opts = {}) => {
    const headers = await getAuthHeaders();
    const res = await fetch(url, { ...opts, headers: { "Content-Type": "application/json", ...headers, ...(opts.headers || {}) } });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Error");
    return data;
  }, [getAuthHeaders]);

  const loadLink = useCallback(async () => {
    try {
      const data = await authedFetch("/api/sleeper/link");
      setLink(data.linked ? data.link : null);
    } catch (e) {
      setLinkError(e.message);
      setLink(null);
    }
  }, [authedFetch]);

  useEffect(() => { loadLink(); }, [loadLink]);

  const doLink = async () => {
    if (!username.trim()) return;
    setLinking(true); setLinkError(null);
    try {
      const data = await authedFetch("/api/sleeper/link", { method: "POST", body: JSON.stringify({ username: username.trim() }) });
      setLink(data.link);
      setUsername("");
    } catch (e) { setLinkError(e.message); }
    setLinking(false);
  };

  const doUnlink = async () => {
    try { await authedFetch("/api/sleeper/link", { method: "DELETE" }); } catch { /* ignore */ }
    setLink(null); setLeagues(null); setActiveLeague(null); setRoster(null); setDraft(null);
  };

  const loadLeagues = useCallback(async () => {
    setLeaguesLoading(true); setLeaguesError(null);
    try {
      const data = await authedFetch(`/api/sleeper/leagues?season=${new Date().getFullYear()}`);
      setLeagues(data.leagues);
      const selected = data.leagues.find((l) => l.selected);
      if (selected) setActiveLeague({ leagueId: selected.leagueId, name: selected.name });
    } catch (e) { setLeaguesError(e.message); }
    setLeaguesLoading(false);
  }, [authedFetch]);

  useEffect(() => { if (link) loadLeagues(); }, [link, loadLeagues]);

  const selectLeague = async (l) => {
    setSelecting(l.leagueId);
    try {
      await authedFetch("/api/sleeper/leagues", { method: "POST", body: JSON.stringify({ leagueId: l.leagueId, season: l.season }) });
      setActiveLeague({ leagueId: l.leagueId, name: l.name });
      setLeagues((prev) => prev.map((x) => ({ ...x, selected: x.leagueId === l.leagueId })));
      setRoster(null); setDraft(null); setView("roster");
    } catch (e) { setLeaguesError(e.message); }
    setSelecting(null);
  };

  const loadRoster = useCallback(async () => {
    if (!activeLeague) return;
    setRosterLoading(true); setRosterError(null);
    try { setRoster(await authedFetch(`/api/sleeper/roster?leagueId=${activeLeague.leagueId}`)); }
    catch (e) { setRosterError(e.message); }
    setRosterLoading(false);
  }, [activeLeague, authedFetch]);

  const loadDraft = useCallback(async () => {
    if (!activeLeague) return;
    setDraftLoading(true); setDraftError(null);
    try { setDraft(await authedFetch(`/api/sleeper/draft?leagueId=${activeLeague.leagueId}`)); }
    catch (e) { setDraftError(e.message); }
    setDraftLoading(false);
  }, [activeLeague, authedFetch]);

  useEffect(() => {
    if (!activeLeague) return;
    if (view === "roster" && roster === null) loadRoster();
    if (view === "draft" && draft === null) loadDraft();
  }, [activeLeague, view, roster, draft, loadRoster, loadDraft]);

  // Poll picks every 8s while a draft is actively underway — the closest
  // thing to "live" without a websocket, matching Sleeper's own doc
  // guidance of polling rather than long-lived connections for this data.
  useEffect(() => {
    if (view !== "draft" || draft?.draft?.status !== "drafting") return;
    const id = setInterval(loadDraft, 8000);
    return () => clearInterval(id);
  }, [view, draft?.draft?.status, loadDraft]);

  if (link === undefined) {
    return <div style={{ color: t.color.textMuted, fontSize: 13, padding: "20px 0", textAlign: "center" }}>Loading…</div>;
  }

  if (!link) {
    return (
      <div style={cardStyle}>
        <div style={{ fontSize: 14, fontWeight: 700, color: t.color.textPrimary, marginBottom: 6 }}>Connect your Sleeper team</div>
        <div style={{ fontSize: 12.5, color: t.color.textMuted, marginBottom: 12 }}>
          Enter your Sleeper username — no password needed, we only read public league data.
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input style={inputStyle} placeholder="Sleeper username" value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && doLink()} />
          <button style={btnStyle(linking || !username.trim())} disabled={linking || !username.trim()} onClick={doLink}>
            {linking ? "Linking…" : "Connect"}
          </button>
        </div>
        {linkError && <div style={{ color: t.color.red, fontSize: 12, marginTop: 8 }}>{linkError}</div>}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontSize: 12.5, color: t.color.textMuted }}>
          Connected as <b style={{ color: t.color.textPrimary }}>{link.sleeper_username}</b>
        </div>
        <button onClick={doUnlink} style={{ background: "none", border: "none", color: t.color.textMuted, fontSize: 11.5, cursor: "pointer", textDecoration: "underline" }}>
          Disconnect
        </button>
      </div>

      {leaguesLoading && <div style={{ color: t.color.textMuted, fontSize: 13 }}>Loading leagues…</div>}
      {leaguesError && <div style={{ color: t.color.red, fontSize: 12.5 }}>{leaguesError}</div>}

      {!leaguesLoading && leagues && leagues.length === 0 && (
        <div style={{ ...cardStyle, textAlign: "center", color: t.color.textMuted, fontSize: 13 }}>
          No {new Date().getFullYear()} Sleeper leagues found for this account yet.
        </div>
      )}

      {!leaguesLoading && leagues && leagues.length > 0 && (!activeLeague || leagues.length > 1) && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {leagues.map((l) => (
            <button key={l.leagueId} onClick={() => selectLeague(l)}
              disabled={selecting === l.leagueId}
              style={{
                ...cardStyle, textAlign: "left", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between",
                borderColor: l.selected ? NFL_ORANGE : t.color.border,
              }}>
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: t.color.textPrimary }}>{l.name}</div>
                <div style={{ fontSize: 11, color: t.color.textMuted }}>{l.totalRosters} teams · {l.status.replace("_", " ")}</div>
              </div>
              {l.selected ? (
                <span style={{ fontSize: 11, fontWeight: 700, color: NFL_ORANGE }}>SYNCED</span>
              ) : (
                <span style={{ fontSize: 11, fontWeight: 700, color: t.color.textMuted }}>{selecting === l.leagueId ? "…" : "Sync →"}</span>
              )}
            </button>
          ))}
        </div>
      )}

      {activeLeague && (
        <>
          <div style={{ display: "flex", gap: 6 }}>
            {[{ id: "roster", label: "Roster" }, { id: "draft", label: "Draft" }].map(({ id, label }) => (
              <button key={id} onClick={() => setView(id)} style={tabButtonStyle({ active: view === id, accent: NFL_ORANGE })}>{label}</button>
            ))}
          </div>

          {view === "roster" && (
            <div style={cardStyle}>
              {rosterLoading && <div style={{ color: t.color.textMuted, fontSize: 13 }}>Loading roster…</div>}
              {rosterError && <div style={{ color: t.color.red, fontSize: 12.5 }}>{rosterError}</div>}
              {roster && (
                <>
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: t.color.textPrimary }}>{roster.teamName || activeLeague.name}</div>
                    {roster.record.wins != null && (
                      <div style={{ fontSize: 12, color: t.color.textMuted, fontFamily: t.font.mono }}>
                        {roster.record.wins}-{roster.record.losses}{roster.record.ties ? `-${roster.record.ties}` : ""}
                      </div>
                    )}
                  </div>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, color: t.color.textMuted, marginBottom: 4 }}>STARTERS</div>
                  {roster.starters.map((p) => <PlayerRow key={p.sleeperId} p={p} />)}
                  {roster.bench.length > 0 && (
                    <>
                      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, color: t.color.textMuted, marginTop: 12, marginBottom: 4 }}>BENCH</div>
                      {roster.bench.map((p) => <PlayerRow key={p.sleeperId} p={p} />)}
                    </>
                  )}
                  {roster.reserve.length > 0 && (
                    <>
                      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, color: t.color.textMuted, marginTop: 12, marginBottom: 4 }}>IR</div>
                      {roster.reserve.map((p) => <PlayerRow key={p.sleeperId} p={p} />)}
                    </>
                  )}
                </>
              )}
            </div>
          )}

          {view === "draft" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {draftLoading && !draft && <div style={{ color: t.color.textMuted, fontSize: 13 }}>Loading draft…</div>}
              {draftError && <div style={{ color: t.color.red, fontSize: 12.5 }}>{draftError}</div>}
              {draft && !draft.draft && (
                <div style={{ ...cardStyle, color: t.color.textMuted, fontSize: 13 }}>No draft found for this league yet.</div>
              )}

              {draft?.draft && (
                <>
                  <div style={cardStyle}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: draft.onClock ? 10 : 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: t.color.textPrimary }}>
                        {draft.draft.status === "drafting" ? "Draft in progress" : draft.draft.status === "complete" ? "Draft complete" : "Draft not started"}
                      </div>
                      {draft.draft.status === "drafting" && (
                        <span style={{ fontSize: 10, fontWeight: 700, color: t.color.brand }}>● LIVE</span>
                      )}
                    </div>

                    {draft.onClock && (
                      <div style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 10px", borderRadius: 8,
                        background: draft.onClock.isMine ? `${NFL_ORANGE}1a` : t.color.surfaceRaised,
                        border: `1px solid ${draft.onClock.isMine ? NFL_ORANGE + "55" : t.color.border}`, marginBottom: 10,
                      }}>
                        <div style={{ fontSize: 12.5, color: t.color.textPrimary }}>
                          Pick <b style={{ fontFamily: t.font.mono }}>#{draft.onClock.pickNo}</b> —{" "}
                          {draft.onClock.isMine ? <b style={{ color: NFL_ORANGE }}>you&apos;re on the clock</b> : (draft.onClock.teamName || "waiting")}
                        </div>
                        {draft.myNextPickNo != null && !draft.onClock.isMine && (
                          <div style={{ fontSize: 11, color: t.color.textMuted, fontFamily: t.font.mono }}>
                            your next: #{draft.myNextPickNo}
                          </div>
                        )}
                      </div>
                    )}

                    <TeamNeeds needs={draft.teamNeeds} />

                    <div style={{ display: "flex", gap: 6 }}>
                      {[{ id: "board", label: "Picks" }, { id: "available", label: "Best Available" }].map(({ id, label }) => (
                        <button key={id} onClick={() => setDraftTab(id)} style={tabButtonStyle({ active: draftTab === id, accent: NFL_ORANGE })}>{label}</button>
                      ))}
                    </div>
                  </div>

                  {draftTab === "board" && (
                    <div style={cardStyle}>
                      {draft.picks.length === 0 ? (
                        <div style={{ color: t.color.textMuted, fontSize: 13 }}>No picks yet.</div>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                          {[...draft.picks].reverse().map((pk) => <DraftPickRow key={pk.pickNo} pick={pk} />)}
                        </div>
                      )}
                    </div>
                  )}

                  {draftTab === "available" && (
                    <div style={cardStyle}>
                      <div style={{ display: "flex", gap: 6, overflowX: "auto", marginBottom: 8 }}>
                        {["ALL", ...FANTASY_POSITIONS].map((pos) => (
                          <button key={pos} onClick={() => setBestAvailPos(pos)} style={{ ...tabButtonStyle({ active: bestAvailPos === pos, accent: NFL_ORANGE }), flexShrink: 0 }}>{pos}</button>
                        ))}
                      </div>
                      {draft.bestAvailable.filter((p) => bestAvailPos === "ALL" || p.position === bestAvailPos).length === 0 ? (
                        <div style={{ color: t.color.textMuted, fontSize: 13 }}>No available players match.</div>
                      ) : (
                        draft.bestAvailable
                          .filter((p) => bestAvailPos === "ALL" || p.position === bestAvailPos)
                          .map((p) => <BestAvailableRow key={p.espn_id} p={p} />)
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
