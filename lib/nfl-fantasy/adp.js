// Average draft position from Fantasy Football Calculator's free API
// (fantasyfootballcalculator.com/api/v1/adp/ppr) — mock-draft ADP (FFC's
// own mock drafts, computer picks filtered out per their site), not
// real-league consensus. v1 is PPR-only; see sql/019_nfl_fantasy_adp.sql.
//
// Confirmed response shape (2026-08-07):
// { status, meta: { type, teams, rounds, total_drafts, start_date, end_date },
//   players: [{ player_id, name, position, team, adp, adp_formatted,
//               times_drafted, high, low, stdev, bye }] }
import { normalizeName } from "./id-map.js";

const FFC_URL = "https://fantasyfootballcalculator.com/api/v1/adp/ppr";

// Guards the caller's delete-stale step: refuses to return a set small
// enough that it looks like an empty/error response rather than real data.
const MIN_PLAYERS = 100;

export async function fetchFfcAdp({ teams = 12, year } = {}) {
  const url = `${FFC_URL}?teams=${teams}${year ? `&year=${year}` : ""}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`FFC ADP fetch failed: ${res.status}`);

  const json = await res.json();
  const players = json?.players || [];
  if (players.length < MIN_PLAYERS) {
    throw new Error(`FFC ADP returned only ${players.length} players (min ${MIN_PLAYERS}) — refusing to touch existing data`);
  }

  return players.map((p) => ({
    ffcPlayerId: String(p.player_id),
    name: p.name,
    position: p.position,
    team: p.team || null,
    adp: p.adp,
    adpHigh: p.high ?? null,
    adpLow: p.low ?? null,
    timesDrafted: p.times_drafted ?? null,
  }));
}

// Ranks every fetched row within its position (1..N) BEFORE any matching —
// an unmatched player (DEF/K, index gaps) still occupies a slot in this
// sort, so it can't shift a matched player's rank the way ranking only the
// matched subset would.
export function rankByPosition(adpRows) {
  const byPosition = new Map();
  for (const row of adpRows) {
    if (!byPosition.has(row.position)) byPosition.set(row.position, []);
    byPosition.get(row.position).push(row);
  }
  for (const rows of byPosition.values()) {
    rows.sort((a, b) => a.adp - b.adp);
    rows.forEach((row, i) => { row.adpPositionRank = i + 1; });
  }
  return adpRows;
}

// rankingRows: nfl_fantasy_rankings rows for the target season/format
// (player_id, name, position). Rows with no match keep playerId: null
// rather than getting dropped — same crosswalk-fallback philosophy as
// lib/nfl-fantasy/id-map.js.
export function matchAdpToPlayerId(adpRows, rankingRows) {
  const byKey = new Map();
  for (const r of rankingRows) {
    byKey.set(`${normalizeName(r.name)}|${r.position}`, r.player_id);
  }
  return adpRows.map((row) => ({
    ...row,
    playerId: byKey.get(`${normalizeName(row.name)}|${row.position}`) || null,
  }));
}
