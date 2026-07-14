/**
 * lib/odds-props.js
 *
 * Per-event MLB player prop odds (pitcher strikeouts, batter anytime home run)
 * from The Odds API. Unlike the sport-wide h2h fetch in lib/odds.js, player
 * props are only available per-event, so this needs a real Odds API event id —
 * use the `id` field of a "theoddsapi"-sourced entry from fetchMLBOdds().
 *
 * IMPORTANT — unverified against a live response: this parses The Odds API's
 * documented player-props outcome shape (`description` = player name, `name`
 * = "Over"/"Under" for strikeouts or "Yes"/"No" for home runs, `point` = the
 * strikeout line). Confirm this against one real event before trusting output
 * in production — see plan's Sequencing step 1.
 */

const TOA_KEY  = process.env.THE_ODDS_API_KEY;
const TOA_BASE = "https://api.the-odds-api.com/v4";
const PROP_BOOK_PRIORITY = ["draftkings", "fanduel", "betmgm", "caesars", "pinnacle", "bet365"];

const TTL = 1000 * 60 * 30; // 30 minutes
const _cache = new Map(); // eventId -> { data, ts }

// Merge outcomes across a bookmaker priority list — prefer the highest-priority
// book that actually offers a line for a given player, rather than locking the
// whole market to one bookmaker (coverage varies book to book).
function pickBestOutcome(outcomesByBook, player, sideNames) {
  for (const book of PROP_BOOK_PRIORITY) {
    const outcomes = outcomesByBook.get(book);
    if (!outcomes) continue;
    const sides = sideNames.map(name => outcomes.find(o => o.description === player && o.name === name));
    if (sides.every(Boolean)) return { sides, bookmaker: book };
  }
  // Fall back to any book that has both sides for this player
  for (const [book, outcomes] of outcomesByBook) {
    const sides = sideNames.map(name => outcomes.find(o => o.description === player && o.name === name));
    if (sides.every(Boolean)) return { sides, bookmaker: book };
  }
  return null;
}

function parseEventProps(event) {
  const strikeoutsByBook = new Map(); // book -> outcomes[]
  const homeRunsByBook   = new Map();
  const players = { strikeouts: new Set(), homeRuns: new Set() };

  for (const bk of event.bookmakers || []) {
    for (const market of bk.markets || []) {
      if (market.key === "pitcher_strikeouts") {
        strikeoutsByBook.set(bk.key, market.outcomes || []);
        for (const o of market.outcomes || []) if (o.description) players.strikeouts.add(o.description);
      } else if (market.key === "batter_home_runs") {
        homeRunsByBook.set(bk.key, market.outcomes || []);
        for (const o of market.outcomes || []) if (o.description) players.homeRuns.add(o.description);
      }
    }
  }

  const strikeouts = [];
  for (const player of players.strikeouts) {
    const best = pickBestOutcome(strikeoutsByBook, player, ["Over", "Under"]);
    if (!best) continue;
    const [over, under] = best.sides;
    if (over.point == null) continue;
    strikeouts.push({
      player,
      line: over.point,
      overOdds: over.price,
      underOdds: under.price,
      bookmaker: best.bookmaker,
    });
  }

  const homeRuns = [];
  for (const player of players.homeRuns) {
    const best = pickBestOutcome(homeRunsByBook, player, ["Yes", "No"]);
    if (!best) continue;
    const [yes, no] = best.sides;
    homeRuns.push({
      player,
      yesOdds: yes.price,
      noOdds: no.price,
      bookmaker: best.bookmaker,
    });
  }

  return { eventId: event.id, homeTeam: event.home_team, awayTeam: event.away_team, strikeouts, homeRuns };
}

export async function fetchEventPlayerProps(eventId) {
  if (!TOA_KEY) throw new Error("THE_ODDS_API_KEY not set");
  const hit = _cache.get(eventId);
  if (hit && Date.now() - hit.ts < TTL) return hit.data;

  const url = `${TOA_BASE}/sports/baseball_mlb/events/${eventId}/odds` +
    `?apiKey=${TOA_KEY}&regions=us&markets=pitcher_strikeouts,batter_home_runs&oddsFormat=american&dateFormat=iso`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`The Odds API props ${res.status}`);
  const event = await res.json();
  const data = parseEventProps(event);
  _cache.set(eventId, { data, ts: Date.now() });
  return data;
}

// Batch fetch across a slate's event ids — failures for individual games don't
// block the rest (a book not offering props for one game is normal, not fatal).
export async function fetchAllPlayerProps(eventIds) {
  const ids = [...new Set((eventIds || []).filter(Boolean))];
  const settled = await Promise.allSettled(ids.map(fetchEventPlayerProps));
  const results = [];
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") results.push(r.value);
    else console.warn(`[odds-props] event ${ids[i]} failed:`, r.reason?.message);
  });
  return results;
}
