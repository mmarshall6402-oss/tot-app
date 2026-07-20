// Shared MLB pick-building blocks used by both the (Pro-gated) live picks list
// and the public free-pick endpoint, so the two can never compute a different
// answer for the same game. Moved out of app/api/picks/route.js verbatim —
// see that file for the fuller live-picks pipeline (cache overlay, live-odds
// refresh, etc.) that still lives there and imports these back.

import { createClient } from "@supabase/supabase-js";
import { fetchMLBOdds } from "./odds.js";
import { calculateEdge } from "./edge.js";
import { getCalibratedModelProbability } from "./probability.js";
import { applyFilterLayer } from "./filter.js";

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export function buildPick(game, mlb, breakdown) {
  const modelProbRaw = getCalibratedModelProbability(game, mlb);

  // Market calibration determines pick DIRECTION only.
  // Displayed edge comes from filter.trueEdgePct — the filter already applies
  // shrinkFactor, compression, and decay. The 20% factor collapses edges to 1-3%.
  const homeImplied  = game.homeImplied || 0.5;
  const modelProb    = homeImplied + (modelProbRaw - homeImplied) * 0.20;
  const rawEdge      = calculateEdge(modelProb, homeImplied);
  const pick         = rawEdge >= 0 ? game.homeTeam : game.awayTeam;
  const homePitcher = mlb?.homePitcher;
  const awayPitcher = mlb?.awayPitcher;
  // Filter uses RAW model probability — it has its own shrinkFactor calibration
  const filter        = applyFilterLayer(pick, { ...game, source: game.source }, mlb, modelProbRaw);
  const filteredIsBet = ["CLEAN", "BET"].includes(filter.verdict);
  const edgePct       = filter.trueEdgePct;

  // Tier from Claude breakdown if available; otherwise derive from filter verdict.
  const verdictTier = filteredIsBet
    ? (filter?.verdict === "CLEAN" || (filter?.confidence || 0) >= 7.5)
      ? { level: "High",   label: "🔥 Value Pick", emoji: "🔥" }
      : (filter?.confidence || 0) >= 6.5
      ? { level: "Medium", label: "✅ Solid Pick",  emoji: "✅" }
      : { level: "Low",    label: "👀 Lean",         emoji: "👀" }
    : { level: "Low", label: "👀 Lean", emoji: "👀" };

  const tier = breakdown?.tier?.level
    ? {
        label: breakdown.tier.level === "High" ? "🔥 Value Pick" : breakdown.tier.level === "Medium" ? "✅ Solid Pick" : "👀 Lean",
        level: breakdown.tier.level,
        emoji: breakdown.tier.level === "High" ? "🔥" : breakdown.tier.level === "Medium" ? "✅" : "👀",
      }
    : verdictTier;

  const ipStr = (p) => p?.inningsPitched ? ` ${p.inningsPitched} IP` : "";
  const homePStr = homePitcher ? `${homePitcher.name} (${homePitcher.wins}-${homePitcher.losses}, ${homePitcher.era} ERA, ${homePitcher.whip} WHIP${ipStr(homePitcher)})` : "TBD";
  const awayPStr = awayPitcher ? `${awayPitcher.name} (${awayPitcher.wins}-${awayPitcher.losses}, ${awayPitcher.era} ERA, ${awayPitcher.whip} WHIP${ipStr(awayPitcher)})` : "N/A";

  const fmtRecord = (s) => s ? `${s.wins}-${s.losses}` : null;
  // Model's own win probability for the picked side, as a 0-100 percentage —
  // lets the client show "Our Model: 63%" and run the "Should I Bet Now?"
  // fair-price check without recomputing modelProb from scratch.
  const pickModelProb = pick === game.homeTeam ? modelProb : 1 - modelProb;
  return {
    id: game.id, homeTeam: game.homeTeam, awayTeam: game.awayTeam,
    homeRecord: fmtRecord(mlb?.homeStandings), awayRecord: fmtRecord(mlb?.awayStandings),
    // Prefer MLB API commenceTime (trusted UTC from mlb.com) over odds API which
    // may return Eastern times without proper UTC conversion.
    commenceTime: mlb?.commenceTime || game.commenceTime,
    homeOdds: game.homeOdds, awayOdds: game.awayOdds,
    modelProb: Math.round(pickModelProb * 100),
    pick, edge: edgePct, isBet: filteredIsBet, tier,
    breakdown: { ...(breakdown || {}), pitcher_home: homePStr, pitcher_away: awayPStr },
    filter,
    liveScore: mlb ? { status: mlb.status, homeScore: mlb.homeScore, awayScore: mlb.awayScore, inning: mlb.inning, inningHalf: mlb.inningHalf } : null,
  };
}

export function matchMLBGame(game, mlbGames) {
  const norm = s => (s || "").toLowerCase().trim();
  const lastWord = s => norm(s).split(" ").pop();
  // Reject matches where game times differ by more than 12 hours (prevents
  // cross-game contamination when last-word matching is ambiguous).
  const timeClose = (t1, t2) => {
    if (!t1 || !t2) return true;
    return Math.abs(new Date(t1) - new Date(t2)) < 12 * 3_600_000;
  };

  // 1. Exact normalized full name — most reliable when both APIs use official names
  let match = mlbGames.find(g =>
    norm(g.homeTeam) === norm(game.homeTeam) &&
    norm(g.awayTeam) === norm(game.awayTeam) &&
    timeClose(g.commenceTime, game.commenceTime)
  );
  if (match) return match;

  // 2. Last-word substring with time guard
  match = mlbGames.find(g =>
    norm(g.homeTeam).includes(lastWord(game.homeTeam)) &&
    norm(g.awayTeam).includes(lastWord(game.awayTeam)) &&
    timeClose(g.commenceTime, game.commenceTime)
  );
  if (match) return match;

  // 3. Two-word suffix (Red Sox / White Sox / Blue Jays) with time guard
  match = mlbGames.find(g => {
    const hw = norm(game.homeTeam).split(" ").slice(-2).join(" ");
    const aw = norm(game.awayTeam).split(" ").slice(-2).join(" ");
    return norm(g.homeTeam).includes(hw) && norm(g.awayTeam).includes(aw) &&
      timeClose(g.commenceTime, game.commenceTime);
  });

  return match || null;
}

// The cache-hit path can add a second entry for the same real-world game when
// the "uncovered MLB games" merge fails to recognize a cached pick as already
// covering it (e.g. a team-name mismatch between the odds source and the MLB
// schedule). Collapse by matchup so the same game never renders twice.
export function dedupeByMatchup(list) {
  const norm = s => (s || "").toLowerCase().trim();
  const score = p => (p.homeOdds != null ? 2 : 0) + (p.breakdown?.preview ? 1 : 0);
  const byKey = new Map();
  for (const p of list) {
    const key = `${norm(p.homeTeam)}|${norm(p.awayTeam)}`;
    const existing = byKey.get(key);
    if (!existing || score(p) > score(existing)) byKey.set(key, p);
  }
  return [...byKey.values()];
}

const ODDS_CACHE_KEY = "__odds__";
const ODDS_TTL_MS = 1000 * 60 * 15; // 15 min

export async function fetchOddsWithCache() {
  const supabase = getSupabase();

  // 1. Check Supabase cross-instance cache first — avoids redundant TOA calls on cold starts
  const { data: sbCached } = await supabase
    .from("picks_cache")
    .select("picks, generated_at")
    .eq("date", ODDS_CACHE_KEY)
    .single();

  if (sbCached?.picks?.length) {
    const age = Date.now() - new Date(sbCached.generated_at).getTime();
    if (age < ODDS_TTL_MS) {
      console.log("[odds] Supabase cache hit, age:", Math.round(age / 60000) + "m");
      return sbCached.picks;
    }
  }

  // 2. Fetch live odds
  try {
    const games = await fetchMLBOdds();
    if (games?.length) {
      supabase
        .from("picks_cache")
        .upsert({ date: ODDS_CACHE_KEY, picks: games, generated_at: new Date().toISOString() }, { onConflict: "date" })
        .then(() => {}).catch(e => console.warn("[odds] Supabase write failed:", e.message));
      return games;
    }
  } catch (e) {
    console.warn("[odds] live fetch failed:", e.message);
  }

  // 3. Stale Supabase cache — better than nothing
  if (sbCached?.picks?.length) {
    const age = Date.now() - new Date(sbCached.generated_at).getTime();
    console.warn("[odds] serving stale Supabase cache, age:", Math.round(age / 60000) + "m");
    return sbCached.picks;
  }

  return [];
}

// Scope odds down to a single CT date — sportsbooks post next-day lines early,
// so without this an off day (All-Star break, rainout) could fall back to
// tomorrow's odds and render them as if they were today's games.
export function filterOddsForDate(oddsGames, date) {
  return oddsGames.filter(g => {
    if (!g.commenceTime) return false;
    const t = new Date(g.commenceTime);
    const utcDate = t.toISOString().split("T")[0];
    const ctParts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(t);
    const ctD = `${ctParts.find(x => x.type === "year").value}-${ctParts.find(x => x.type === "month").value}-${ctParts.find(x => x.type === "day").value}`;
    return utcDate === date || ctD === date;
  });
}

// Match an odds-API game to an MLB-schedule game (opposite direction from
// matchMLBGame, which matches a cached pick back to today's MLB schedule).
export function matchOddsToMLBGame(mlbGame, oddsForDate) {
  const norm = s => (s || "").toLowerCase().trim();
  const lastWord = s => norm(s).split(" ").pop();
  const matchTeams = (oddsName, mlbName) => {
    const on = norm(oddsName), mn = norm(mlbName);
    if (on === mn) return true;
    if (on.includes(lastWord(mn))) return true;
    // 2-word suffix for "White Sox", "Red Sox", "Blue Jays"
    const tail2 = mn.split(" ").slice(-2).join(" ");
    if (tail2.length > 3 && on.includes(tail2)) return true;
    // shared meaningful word (>3 chars, ignoring "the", "of", "los", "san", etc.)
    const skip = new Set(["the","los","san","new","york","city"]);
    const mWords = mn.split(" ").filter(w => w.length > 3 && !skip.has(w));
    return mWords.some(w => on.includes(w));
  };
  return oddsForDate.find(g =>
    matchTeams(g.homeTeam, mlbGame.homeTeam) &&
    matchTeams(g.awayTeam, mlbGame.awayTeam)
  ) || null;
}

// Always-live "no stale cache" build of today's MLB picks — the same
// ground-truth computation app/api/picks/route.js falls back to when there's
// no picks_cache row yet. Used by /api/free-pick so the promoted free pick can
// never contradict what the live picks list is currently showing for the same
// game (picks_cache can otherwise sit stale for hours after odds move or the
// model/filter itself changes, since it's only overwritten when someone loads
// the Picks tab).
export async function buildFreshMLBPicks(date) {
  const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

  const [oddsGames, mlbRes] = await Promise.all([
    fetchOddsWithCache().catch(() => []),
    fetch(`${BASE_URL}/api/mlb?date=${date}`).then(r => r.json()).catch(() => ({ games: [] })),
  ]);

  const mlbGames = mlbRes?.games || [];
  const oddsForDate = filterOddsForDate(oddsGames, date);

  const results = mlbGames.length
    ? mlbGames.map(mlbGame => {
        const oddsGame = matchOddsToMLBGame(mlbGame, oddsForDate);
        if (!oddsGame) return null; // no line yet — nothing to promote as a free pick
        return buildPick({ ...oddsGame, commenceTime: mlbGame.commenceTime }, mlbGame, null);
      }).filter(Boolean)
    : oddsForDate.map(game => buildPick(game, null, null)).filter(Boolean);

  return dedupeByMatchup(results);
}
