// SportsData.io live weekly fantasy stats — the resolution counterpart to
// lib/nfl-fantasy/probability-backtest.js's historical replay. Used by
// app/api/cron/nfl-fantasy-resolve to grade unresolved rows in
// fantasy_probability_log (sql/018) and fantasy_gut_calls (sql/019) once a
// week's games are final.
//
// This provider was chosen over re-fetching nflverse's aggregated
// player_stats_<season>.csv (scripts/nfl-fantasy/fetch-nflverse.js) for two
// reasons documented in that script: the aggregated rollup is known to lag
// behind for the most recent season, and the alternative (raw play-by-play)
// runs 90MB+ per season — not something to pull on a cron. SportsData.io's
// per-week endpoint returns just that week's rows, already paid for and
// partially wired (lib/nfl-roster.js's player-detail overlay).
//
// UNVERIFIED against a live call, same caveat as the rest of this app's
// SportsData.io integration — outbound access to api.sportsdata.io isn't
// reachable from this sandbox. Endpoint/field names follow SportsData.io's
// standard, long-documented NFL v3 API shape. Every function here degrades
// to null on any failure or shape mismatch — a bad response must leave
// rows unresolved, never resolve them incorrectly.
import { normalizeName } from "./id-map.js";

const SPORTSDATA_KEY = process.env.SPORTSDATA_API_KEY;
const SPORTSDATA_BASE = "https://api.sportsdata.io/v3/nfl";

export async function fetchLastCompletedWeek() {
  if (!SPORTSDATA_KEY) return null;
  try {
    const res = await fetch(`${SPORTSDATA_BASE}/scores/json/LastCompletedWeek?key=${SPORTSDATA_KEY}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const week = Number(await res.json());
    return Number.isFinite(week) && week > 0 ? week : null;
  } catch (e) {
    console.warn("[nfl-fantasy] LastCompletedWeek fetch failed:", e.message);
    return null;
  }
}

// Same raw-stat-component shape lib/nfl-fantasy/scoring.js's
// weeklyFantasyPoints() expects, so live resolution runs through the exact
// same scoring formula as the historical backtest rather than trusting
// SportsData.io's own FantasyPoints/FantasyPointsPPR fields directly (which
// don't obviously cover Half-PPR, one of this app's three formats).
function toScoringStatLine(row) {
  return {
    passing_yards: row.PassingYards,
    passing_tds: row.PassingTouchdowns,
    passing_interceptions: row.PassingInterceptions,
    rushing_yards: row.RushingYards,
    rushing_tds: row.RushingTouchdowns,
    receiving_yards: row.ReceivingYards,
    receiving_tds: row.ReceivingTouchdowns,
    receptions: row.Receptions,
    fumbles_lost: row.FumblesLost,
  };
}

// Returns a lookup function (name -> scoring-ready stat line, or null if
// that player didn't show up in this week's box scores) rather than a bare
// Map — a straight name miss falls back to last-name matching, the same
// posture lib/nfl-roster.js's findSportsDataPlayer already uses for this
// exact provider's separate-ID-space problem. Returns null (not a function)
// on total fetch failure, so callers can tell "nobody found" apart from
// "couldn't even ask."
export async function fetchWeeklyStatLines(season, week) {
  if (!SPORTSDATA_KEY) return null;
  try {
    const res = await fetch(`${SPORTSDATA_BASE}/stats/json/PlayerGameStatsByWeek/${season}/${week}?key=${SPORTSDATA_KEY}`, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) { console.warn(`[nfl-fantasy] PlayerGameStatsByWeek ${res.status}`); return null; }
    const json = await res.json();
    if (!Array.isArray(json)) return null;

    const byName = new Map();
    for (const row of json) {
      const name = normalizeName(row.Name);
      if (name) byName.set(name, row);
    }

    return function lookupStatLine(playerName) {
      const q = normalizeName(playerName);
      if (byName.has(q)) return toScoringStatLine(byName.get(q));
      const lastWord = q.split(" ").pop();
      for (const [n, row] of byName) {
        if (n.split(" ").pop() === lastWord) return toScoringStatLine(row);
      }
      return null; // not in this week's box scores — caller must not guess a 0
    };
  } catch (e) {
    console.warn("[nfl-fantasy] weekly stat lines fetch failed:", e.message);
    return null;
  }
}
