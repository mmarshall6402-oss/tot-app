/**
 * lib/nfl-odds-props.js
 *
 * Per-event NFL player prop odds (receptions, receiving yards, rushing
 * yards, passing yards, anytime TD) from The Odds API. Mirrors
 * lib/odds-props.js's MLB player-props fetcher — same per-event endpoint
 * shape, same book-priority merge, same cache posture — just a different
 * set of market keys and an extra Over/Under market family instead of a
 * single strikeout line.
 *
 * IMPORTANT — unverified against a live response: this parses The Odds
 * API's documented player-props outcome shape (`description` = player
 * name, `name` = "Over"/"Under" or "Yes"/"No", `point` = the stat line).
 * Confirm against one real NFL event with props posted before trusting
 * output in production.
 */

import { createClient } from "@supabase/supabase-js";

const TOA_KEY  = process.env.THE_ODDS_API_KEY;
const TOA_BASE = "https://api.the-odds-api.com/v4";
const PROP_BOOK_PRIORITY = ["draftkings", "fanduel", "betmgm", "caesars", "pinnacle", "bet365"];

const getSupabase = () => (process.env.SUPABASE_SERVICE_ROLE_KEY
  ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  : null);

// Player props sit in The Odds API's expensive credit tier, and a popular
// player's game can get requested many times an hour across concurrent
// Start/Sit calls. This Supabase-backed cache (sql/018_nfl_prop_lines_cache.sql)
// is shared across serverless instances, unlike the in-memory _cache below,
// so it's the real defense against credit burn — the in-memory cache just
// saves a DB round-trip within one warm instance.
const DB_CACHE_TTL = 1000 * 60 * 60 * 3; // 3 hours — props don't move fast enough to need fresher than this

// Over/Under markets, keyed by the stat they represent — order here is the
// fallback preference when a player has lines in more than one market.
const OU_MARKETS = ["player_receptions", "player_reception_yds", "player_rush_yds", "player_pass_yds"];
const YES_NO_MARKETS = ["player_anytime_td"];
const ALL_MARKETS = [...OU_MARKETS, ...YES_NO_MARKETS];

const TTL = 1000 * 60 * 30; // 30 minutes
const _cache = new Map(); // eventId -> { data, ts }

function pickBestOutcome(outcomesByBook, player, sideNames) {
  for (const book of PROP_BOOK_PRIORITY) {
    const outcomes = outcomesByBook.get(book);
    if (!outcomes) continue;
    const sides = sideNames.map(name => outcomes.find(o => o.description === player && o.name === name));
    if (sides.every(Boolean)) return { sides, bookmaker: book };
  }
  for (const [book, outcomes] of outcomesByBook) {
    const sides = sideNames.map(name => outcomes.find(o => o.description === player && o.name === name));
    if (sides.every(Boolean)) return { sides, bookmaker: book };
  }
  return null;
}

function parseEventProps(event) {
  const byMarket = new Map(); // marketKey -> Map(book -> outcomes[])
  const playersByMarket = new Map(); // marketKey -> Set(player names)

  for (const bk of event.bookmakers || []) {
    for (const market of bk.markets || []) {
      if (!ALL_MARKETS.includes(market.key)) continue;
      if (!byMarket.has(market.key)) byMarket.set(market.key, new Map());
      byMarket.get(market.key).set(bk.key, market.outcomes || []);
      if (!playersByMarket.has(market.key)) playersByMarket.set(market.key, new Set());
      for (const o of market.outcomes || []) if (o.description) playersByMarket.get(market.key).add(o.description);
    }
  }

  const lines = { }; // marketKey -> [{ player, line, overOdds, underOdds, bookmaker }]
  for (const marketKey of OU_MARKETS) {
    const outcomesByBook = byMarket.get(marketKey);
    if (!outcomesByBook) continue;
    const rows = [];
    for (const player of playersByMarket.get(marketKey) || []) {
      const best = pickBestOutcome(outcomesByBook, player, ["Over", "Under"]);
      if (!best) continue;
      const [over, under] = best.sides;
      if (over.point == null) continue;
      rows.push({ player, line: over.point, overOdds: over.price, underOdds: under.price, bookmaker: best.bookmaker });
    }
    lines[marketKey] = rows;
  }

  for (const marketKey of YES_NO_MARKETS) {
    const outcomesByBook = byMarket.get(marketKey);
    if (!outcomesByBook) continue;
    const rows = [];
    for (const player of playersByMarket.get(marketKey) || []) {
      const best = pickBestOutcome(outcomesByBook, player, ["Yes", "No"]);
      if (!best) continue;
      const [yes, no] = best.sides;
      rows.push({ player, yesOdds: yes.price, noOdds: no.price, bookmaker: best.bookmaker });
    }
    lines[marketKey] = rows;
  }

  return { eventId: event.id, homeTeam: event.home_team, awayTeam: event.away_team, ...lines };
}

async function readDbCache(eventId) {
  const supabase = getSupabase();
  if (!supabase) return null;
  try {
    const { data } = await supabase.from("nfl_prop_lines_cache")
      .select("data, fetched_at").eq("event_id", eventId).single();
    return data || null;
  } catch {
    return null;
  }
}

function writeDbCache(eventId, data) {
  const supabase = getSupabase();
  if (!supabase) return;
  supabase.from("nfl_prop_lines_cache")
    .upsert({ event_id: eventId, data, fetched_at: new Date().toISOString() }, { onConflict: "event_id" })
    .then(() => {}).catch(e => console.warn("[nfl-odds-props] cache write failed:", e.message));
}

export async function fetchNFLEventPlayerProps(eventId) {
  const hit = _cache.get(eventId);
  if (hit && Date.now() - hit.ts < TTL) return hit.data;

  const dbHit = await readDbCache(eventId);
  if (dbHit && Date.now() - new Date(dbHit.fetched_at).getTime() < DB_CACHE_TTL) {
    _cache.set(eventId, { data: dbHit.data, ts: Date.now() });
    return dbHit.data;
  }

  if (!TOA_KEY) {
    if (dbHit) return dbHit.data; // stale but real, better than nothing
    throw new Error("THE_ODDS_API_KEY not set");
  }

  try {
    const url = `${TOA_BASE}/sports/americanfootball_nfl/events/${eventId}/odds` +
      `?apiKey=${TOA_KEY}&regions=us&markets=${ALL_MARKETS.join(",")}&oddsFormat=american&dateFormat=iso`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`The Odds API NFL props ${res.status}`);
    const event = await res.json();
    const data = parseEventProps(event);
    _cache.set(eventId, { data, ts: Date.now() });
    writeDbCache(eventId, data);
    return data;
  } catch (e) {
    // A live-fetch failure with a stale DB row available is still better
    // than surfacing nothing — same "serve stale over serving an error"
    // posture as the rest of the odds pipeline's degrade paths.
    if (dbHit) return dbHit.data;
    throw e;
  }
}
