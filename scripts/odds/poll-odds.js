// Standalone script — NOT a Next.js route. Polls live odds every few
// minutes during actual game windows and appends to odds_history
// (sql/020_odds_history.sql) for the odds-over-time "stock chart" feature.
//
// Meant to run on an always-on box via crontab (not Vercel): sub-hourly
// polling doesn't fit Vercel's cron model (daily granularity by default)
// or its per-invocation cost well, and this needs to poll every few
// minutes only while games are actually live. Exits with zero API calls
// when nothing's in its live window, so a tight crontab schedule (e.g.
// */5 * * * *) is cheap the rest of the day.
//
// Reuses the existing odds fetchers as-is (lib/odds.js, lib/nfl-odds.js) —
// no new odds-fetching/parsing logic, just flattening what they already
// return into generic (sport, market, side) rows and appending instead of
// upserting, so every poll is kept rather than overwritten.
import { createClient } from "@supabase/supabase-js";
import { fetchMLBOdds } from "../../lib/odds.js";
import { fetchNFLOdds } from "../../lib/nfl-odds.js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const LIVE_WINDOW_BEFORE_MS = 30 * 60 * 1000; // start polling 30 min before commence
const LIVE_WINDOW_AFTER_MS = 4 * 60 * 60 * 1000; // stop ~4h after commence (covers a full game + OT)

function isWithinLiveWindow(commenceTime, now = new Date()) {
  if (!commenceTime) return false;
  const t = new Date(commenceTime).getTime();
  return now.getTime() >= t - LIVE_WINDOW_BEFORE_MS && now.getTime() <= t + LIVE_WINDOW_AFTER_MS;
}

// g: a game object from fetchMLBOdds()/fetchNFLOdds() — MLB only ever
// carries moneyline fields, NFL carries moneyline + spread + total, so
// each market's rows are just skipped when the source fields are absent.
function flattenGame(sport, g, capturedAt) {
  const base = {
    sport,
    game_id: String(g.id ?? `${g.homeTeam}-${g.awayTeam}-${g.commenceTime}`),
    home_team: g.homeTeam,
    away_team: g.awayTeam,
    commence_time: g.commenceTime || null,
    captured_at: capturedAt,
  };
  const rows = [];
  if (g.homeOdds != null) rows.push({ ...base, market: "moneyline", side: "home", line: null, odds: g.homeOdds, implied_prob: g.homeImplied ?? null });
  if (g.awayOdds != null) rows.push({ ...base, market: "moneyline", side: "away", line: null, odds: g.awayOdds, implied_prob: g.awayImplied ?? null });
  if (g.homeSpreadOdds != null) rows.push({ ...base, market: "spread", side: "home", line: g.spread ?? null, odds: g.homeSpreadOdds, implied_prob: null });
  if (g.awaySpreadOdds != null) rows.push({ ...base, market: "spread", side: "away", line: g.spread != null ? -g.spread : null, odds: g.awaySpreadOdds, implied_prob: null });
  if (g.overOdds != null) rows.push({ ...base, market: "total", side: "over", line: g.total ?? null, odds: g.overOdds, implied_prob: null });
  if (g.underOdds != null) rows.push({ ...base, market: "total", side: "under", line: g.total ?? null, odds: g.underOdds, implied_prob: null });
  return rows;
}

async function pollSport(sport, fetchOdds) {
  const games = await fetchOdds().catch((e) => {
    console.warn(`[poll-odds] ${sport} fetch failed:`, e.message);
    return [];
  });

  const live = games.filter((g) => isWithinLiveWindow(g.commenceTime));
  if (!live.length) return 0;

  const capturedAt = new Date().toISOString();
  const rows = live.flatMap((g) => flattenGame(sport, g, capturedAt));
  if (!rows.length) return 0;

  const { error } = await supabase.from("odds_history").insert(rows);
  if (error) {
    console.warn(`[poll-odds] ${sport} insert failed:`, error.message);
    return 0;
  }
  return rows.length;
}

const [mlbRows, nflRows] = await Promise.all([
  pollSport("mlb", fetchMLBOdds),
  pollSport("nfl", fetchNFLOdds),
]);

console.log(`[poll-odds] ${new Date().toISOString()} inserted mlb=${mlbRows} nfl=${nflRows} rows`);
