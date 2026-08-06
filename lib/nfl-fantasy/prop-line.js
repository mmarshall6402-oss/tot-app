// Resolves a fantasy player to the sportsbook prop line for their signature
// stat (receptions for WR/TE, rushing yards for RB, passing yards for QB)
// and formats it alongside our own VORP/projection data — this is the
// differentiator behind Start/Sit and Trade: the same answer that grounds
// itself in our fantasy rankings also surfaces what the market is pricing
// that player at, so the user sees "we project X" next to "the book has Y"
// in one place instead of checking two tools.
import { fetchNFLOdds } from "../nfl-odds.js";
import { fetchNFLEventPlayerProps } from "../nfl-odds-props.js";
import { nflTeamFullName } from "../nfl-team-names.js";

const ODDS_TTL = 5 * 60 * 1000; // 5 min — avoids re-hitting The Odds API for every player in the same request/burst
let _oddsCache = { games: null, ts: 0 };

async function upcomingGames() {
  if (_oddsCache.games && Date.now() - _oddsCache.ts < ODDS_TTL) return _oddsCache.games;
  const games = await fetchNFLOdds().catch(() => []);
  _oddsCache = { games, ts: Date.now() };
  return games;
}

async function findUpcomingEventForTeam(teamAbbrOrName) {
  const fullName = nflTeamFullName(teamAbbrOrName);
  if (!fullName) return null;
  const games = await upcomingGames();
  const now = Date.now();
  const matches = games.filter(g => g.homeTeam === fullName || g.awayTeam === fullName);
  const upcoming = matches.filter(g => !g.commenceTime || new Date(g.commenceTime).getTime() >= now);
  const pool = upcoming.length ? upcoming : matches;
  pool.sort((a, b) => new Date(a.commenceTime || 0) - new Date(b.commenceTime || 0));
  return pool[0] || null;
}

// Market keys/labels to try, in priority order, per position. WR/TE lead
// with receptions (the most PPR-relevant stat and best example of "the prop
// vs our projection"); RB/QB lead with their own bread-and-butter yardage.
const MARKETS_BY_POSITION = {
  WR: [["player_receptions", "receptions"], ["player_reception_yds", "receiving yards"]],
  TE: [["player_receptions", "receptions"], ["player_reception_yds", "receiving yards"]],
  RB: [["player_rush_yds", "rushing yards"], ["player_receptions", "receptions"]],
  QB: [["player_pass_yds", "passing yards"]],
};

function normName(s) {
  return (s || "").toLowerCase().trim().replace(/[.'-]/g, "").replace(/\s+/g, " ");
}
function matchPlayerRow(name, rows) {
  const n = normName(name);
  if (!n || !rows?.length) return null;
  let hit = rows.find(r => normName(r.player) === n);
  if (hit) return hit;
  const last = n.split(" ").pop();
  return rows.find(r => normName(r.player).split(" ").pop() === last) || null;
}

function fmtOdds(o) {
  return o == null ? "" : o > 0 ? `+${o}` : `${o}`;
}

// Returns a formatted context line like:
// "Market prop (DraftKings): 4.5 receptions (O -115 / U -105)"
// or null if no team/props data is available — callers should degrade
// gracefully, same posture as the rest of the fantasy lookup chain.
export async function propLineForPlayer(player) {
  if (!player?.team || !player?.position) return null;
  try {
    const event = await findUpcomingEventForTeam(player.team);
    if (!event) return null;
    const props = await fetchNFLEventPlayerProps(event.id);
    const marketOrder = MARKETS_BY_POSITION[player.position.toUpperCase()] || [];
    for (const [marketKey, label] of marketOrder) {
      const rows = props[marketKey];
      const row = matchPlayerRow(player.name, rows);
      if (!row) continue;
      return `Market prop (${row.bookmaker}): ${row.line} ${label} (O ${fmtOdds(row.overOdds)} / U ${fmtOdds(row.underOdds)})`;
    }
    return null;
  } catch (e) {
    console.warn("[nfl-fantasy] prop line lookup failed:", e.message);
    return null;
  }
}
