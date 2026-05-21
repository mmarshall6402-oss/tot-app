import { createClient } from "@supabase/supabase-js";
import { fetchMLBOdds } from "../../../lib/odds.js";
import { calculateEdge, BET_THRESHOLD, getConfidenceTier, americanToDecimal, decimalToImplied, removeVig } from "../../../lib/edge.js";
import { getModelProbability } from "../../../lib/probability.js";
import { applyFilterLayer, buildParlayCards } from "../../../lib/filter.js";
import { requirePro } from "../../../lib/auth.js";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
// Server-side route — use service role key to bypass RLS on picks_cache reads
const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

function buildPick(game, mlb, breakdown) {
  const modelProbRaw = getModelProbability(game, mlb);

  // Market calibration: the market already prices in most public information.
  // Our model provides ~20% incremental signal on top of market pricing.
  // This shrinks raw edges to realistic MLB magnitudes (1–8%) and prevents
  // data corruption from inflating phantom edges to 20–40%.
  const homeImplied  = game.homeImplied || 0.5;
  const modelProb    = homeImplied + (modelProbRaw - homeImplied) * 0.20;

  const rawEdge  = calculateEdge(modelProb, homeImplied);
  const pick     = rawEdge >= 0 ? game.homeTeam : game.awayTeam;
  // Hard cap: >8% displayed edge almost never exists in liquid MLB markets
  const edgePct  = Math.min(Math.abs(rawEdge) * 100, 8.0);
  const isBet    = edgePct >= BET_THRESHOLD * 100;

  const homePitcher = mlb?.homePitcher;
  const awayPitcher = mlb?.awayPitcher;
  // Filter uses RAW model probability — it has its own shrinkFactor calibration
  const filter    = applyFilterLayer(pick, { ...game, source: game.source }, mlb, modelProbRaw);
  const filteredIsBet = ["CLEAN", "BET"].includes(filter.verdict);

  // Tier from Claude breakdown if available; otherwise derive from filter verdict.
  // Edge-based tier (getConfidenceTier) maps 2-8% → Low for almost all picks after
  // market calibration, so we prefer the verdict signal instead.
  const verdictTier = filteredIsBet
    ? (filter?.verdict === "CLEAN" || (filter?.confidence || 0) >= 7.5)
      ? { level: "High",   label: "🔥 Value Pick", emoji: "🔥" }
      : (filter?.confidence || 0) >= 6
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

  return {
    id: game.id, homeTeam: game.homeTeam, awayTeam: game.awayTeam,
    // Prefer MLB API commenceTime (trusted UTC from mlb.com) over odds API which
    // may return Eastern times without proper UTC conversion.
    commenceTime: mlb?.commenceTime || game.commenceTime,
    homeOdds: game.homeOdds, awayOdds: game.awayOdds,
    pick, edge: edgePct, isBet: filteredIsBet, tier,
    breakdown: { ...(breakdown || {}), pitcher_home: homePStr, pitcher_away: awayPStr },
    filter,
    liveScore: mlb ? { status: mlb.status, homeScore: mlb.homeScore, awayScore: mlb.awayScore, inning: mlb.inning, inningHalf: mlb.inningHalf } : null,
  };
}

function matchMLBGame(game, mlbGames) {
  const norm = s => (s || "").toLowerCase().trim();
  const lastWord = s => norm(s).split(" ").pop();
  // Reject matches where game times differ by more than 6 hours (prevents
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

const ODDS_CACHE_KEY = "__odds__";
const ODDS_TTL_MS = 1000 * 60 * 15; // 15 min

async function fetchOddsWithCache() {
  const supabase = getSupabase();
  // 1. Try live API
  try {
    const games = await fetchMLBOdds();
    if (games?.length) {
      // Persist to Supabase so the next cold instance can use it
      supabase
        .from("picks_cache")
        .upsert({ date: ODDS_CACHE_KEY, picks: games, generated_at: new Date().toISOString() }, { onConflict: "date" })
        .then(() => {}).catch(() => {});
      return games;
    }
  } catch (e) {
    console.warn("[odds] live fetch failed:", e.message);
  }

  // 2. Fall back to Supabase-cached odds
  const { data } = await supabase
    .from("picks_cache")
    .select("picks, generated_at")
    .eq("date", ODDS_CACHE_KEY)
    .single();

  if (data?.picks?.length) {
    const age = Date.now() - new Date(data.generated_at).getTime();
    if (age < ODDS_TTL_MS) {
      console.warn("[odds] using Supabase-cached odds, age:", Math.round(age / 1000) + "s");
      return data.picks;
    }
    // Stale but better than nothing
    console.warn("[odds] Supabase odds stale but serving anyway");
    return data.picks;
  }

  return [];
}

export async function GET(request) {
  const { error: authError } = await requirePro(request);
  if (authError) return authError;

  const supabase = getSupabase();
  try {
    const { searchParams } = new URL(request.url);
    // Use Eastern Time as the canonical "today" — MLB is a US sport and users
    // expect today's picks through midnight ET, not midnight UTC (4 AM ET).
    const etParts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(new Date());
    const today = `${etParts.find(p => p.type === "year").value}-${etParts.find(p => p.type === "month").value}-${etParts.find(p => p.type === "day").value}`;
    const date = searchParams.get("date") || today;
    const bust = searchParams.get("bust") === "1";

    const { data: cached } = await supabase
      .from("picks_cache")
      .select("picks, generated_at")
      .eq("date", date)
      .single();

    // Only serve from cache for today — past dates use the MLB-direct path which
    // always returns final scores. Future dates are never cached (no-op here).
    if (!bust && cached?.picks?.length && date >= today) {
      // Fetch fresh MLB data — update live scores, pitchers, AND recompute filter.
      // Critical: cron runs at 7 AM ET before pitchers are announced, so cached filter
      // may be PASS due to NO_PITCHER_DATA. Recompute with current data so picks flip
      // to BET/CLEAN once starters post (~90 min before first pitch).
      const mlbRes = await fetch(`${BASE_URL}/api/mlb?date=${date}`).then(r => r.json()).catch(() => ({ games: [] }));
      const mlbGames = mlbRes?.games || [];
      const ipStr = (p) => p?.inningsPitched ? ` ${p.inningsPitched} IP` : "";
      const picks = mlbGames.length
        ? cached.picks.map(pick => {
            const mlb = matchMLBGame(pick, mlbGames);
            if (!mlb) return pick;

            const homePStr = mlb.homePitcher ? `${mlb.homePitcher.name} (${mlb.homePitcher.wins}-${mlb.homePitcher.losses}, ${mlb.homePitcher.era} ERA, ${mlb.homePitcher.whip} WHIP${ipStr(mlb.homePitcher)})` : null;
            const awayPStr = mlb.awayPitcher ? `${mlb.awayPitcher.name} (${mlb.awayPitcher.wins}-${mlb.awayPitcher.losses}, ${mlb.awayPitcher.era} ERA, ${mlb.awayPitcher.whip} WHIP${ipStr(mlb.awayPitcher)})` : null;

            // Reconstruct homeImplied from stored odds so model + filter can run
            let gameWithImplied = pick;
            if (pick.homeOdds && pick.awayOdds) {
              const hDec = americanToDecimal(pick.homeOdds);
              const aDec = americanToDecimal(pick.awayOdds);
              const { fairHome, fairAway } = removeVig(decimalToImplied(hDec), decimalToImplied(aDec));
              gameWithImplied = { ...pick, homeImplied: fairHome, awayImplied: fairAway };
            }

            const modelProbRaw = getModelProbability(gameWithImplied, mlb);
            const homeImplied  = gameWithImplied.homeImplied || 0.5;
            const modelProb    = homeImplied + (modelProbRaw - homeImplied) * 0.20;
            const rawEdge      = calculateEdge(modelProb, homeImplied);
            const freshPick    = rawEdge >= 0 ? pick.homeTeam : pick.awayTeam;
            const edgePct      = Math.min(Math.abs(rawEdge) * 100, 8.0);
            const freshFilter  = applyFilterLayer(freshPick, { ...gameWithImplied, source: pick.filter?.isSquareLine ? "sportsdata" : undefined }, mlb, modelProbRaw);
            const filteredIsBet = ["CLEAN", "BET"].includes(freshFilter.verdict);
            const tier = pick.breakdown?.tier?.level
              ? { label: pick.breakdown.tier.level === "High" ? "🔥 Value Pick" : pick.breakdown.tier.level === "Medium" ? "✅ Solid Pick" : "👀 Lean", level: pick.breakdown.tier.level }
              : getConfidenceTier(edgePct / 100) || { label: "👀 Lean", level: "Low" };

            return {
              ...pick,
              pick: freshPick,
              edge: edgePct,
              isBet: filteredIsBet,
              tier,
              filter: freshFilter,
              liveScore: { status: mlb.status, homeScore: mlb.homeScore, awayScore: mlb.awayScore, inning: mlb.inning, inningHalf: mlb.inningHalf },
              breakdown: {
                ...pick.breakdown,
                pitcher_home: homePStr || pick.breakdown?.pitcher_home,
                pitcher_away: awayPStr || pick.breakdown?.pitcher_away,
              },
            };
          })
        : cached.picks;
      return Response.json({ picks, cached: true, generated_at: cached.generated_at });
    }

    // Past date with no cache — build results from MLB API directly (odds aren't available for past dates)
    if (date < today) {
      const mlbRes = await fetch(`${BASE_URL}/api/mlb?date=${date}`).then(r => r.json()).catch(() => ({ games: [] }));
      const mlbGames = mlbRes?.games || [];
      if (mlbGames.length) {
        const ipStr = (p) => p?.inningsPitched ? ` ${p.inningsPitched} IP` : "";
        const results = mlbGames.map(g => {
          const modelProb = getModelProbability({ homeTeam: g.homeTeam, awayTeam: g.awayTeam, homeImplied: 0.5, commenceTime: g.commenceTime }, g);
          const pick = modelProb >= 0.5 ? g.homeTeam : g.awayTeam;
          return {
            id: String(g.gameId),
            homeTeam: g.homeTeam, awayTeam: g.awayTeam,
            commenceTime: g.commenceTime,
            homeOdds: null, awayOdds: null,
            pick, edge: Math.abs(modelProb - 0.5) * 100,
            isBet: false,
            tier: { label: "📋 Result", level: "Low", emoji: "📋" },
            breakdown: {
              pitcher_home: g.homePitcher ? `${g.homePitcher.name} (${g.homePitcher.wins}-${g.homePitcher.losses}, ${g.homePitcher.era} ERA${ipStr(g.homePitcher)})` : "TBD",
              pitcher_away: g.awayPitcher ? `${g.awayPitcher.name} (${g.awayPitcher.wins}-${g.awayPitcher.losses}, ${g.awayPitcher.era} ERA${ipStr(g.awayPitcher)})` : "N/A",
            },
            filter: null,
            liveScore: { status: g.status, homeScore: g.homeScore, awayScore: g.awayScore, inning: g.inning, inningHalf: g.inningHalf },
          };
        });
        return Response.json({ picks: results, cached: false, pastDate: true });
      }
      return Response.json({ picks: [], cached: false, notice: "no data for this date" });
    }

    const [oddsGames, mlbRes] = await Promise.all([
      fetchOddsWithCache(),
      fetch(`${BASE_URL}/api/mlb?date=${date}`).then(r => r.json()).catch(() => ({ games: [] })),
    ]);

    const mlbGames = mlbRes?.games || [];

    // MLB schedule is the date-authoritative source — iterate it so we always show
    // the right games for the date. Odds supplement each game where lines are posted.
    // Games with no odds show as informational (no edge, no BET label).
    const norm = s => (s || "").toLowerCase().trim();
    const lastWord = s => norm(s).split(" ").pop();
    const findOdds = (mlbGame) => oddsGames.find(g =>
      norm(g.homeTeam).includes(lastWord(mlbGame.homeTeam)) &&
      norm(g.awayTeam).includes(lastWord(mlbGame.awayTeam))
    ) || null;

    const ipStr2 = (p) => p?.inningsPitched ? ` ${p.inningsPitched} IP` : "";

    const results = mlbGames.length
      ? mlbGames.map(mlbGame => {
          const oddsGame = findOdds(mlbGame);
          if (oddsGame) {
            return buildPick({ ...oddsGame, commenceTime: mlbGame.commenceTime }, mlbGame, null);
          }
          // No odds yet — show game as informational
          const modelProb = getModelProbability({ homeTeam: mlbGame.homeTeam, awayTeam: mlbGame.awayTeam, homeImplied: 0.5, commenceTime: mlbGame.commenceTime }, mlbGame);
          const pick = modelProb >= 0.5 ? mlbGame.homeTeam : mlbGame.awayTeam;
          return {
            id: String(mlbGame.gameId), homeTeam: mlbGame.homeTeam, awayTeam: mlbGame.awayTeam,
            commenceTime: mlbGame.commenceTime, homeOdds: null, awayOdds: null,
            pick, edge: 0, isBet: false, tier: { label: "📋 No Line", level: "Low", emoji: "📋" },
            breakdown: {
              pitcher_home: mlbGame.homePitcher ? `${mlbGame.homePitcher.name} (${mlbGame.homePitcher.wins}-${mlbGame.homePitcher.losses}, ${mlbGame.homePitcher.era} ERA${ipStr2(mlbGame.homePitcher)})` : "TBD",
              pitcher_away: mlbGame.awayPitcher ? `${mlbGame.awayPitcher.name} (${mlbGame.awayPitcher.wins}-${mlbGame.awayPitcher.losses}, ${mlbGame.awayPitcher.era} ERA${ipStr2(mlbGame.awayPitcher)})` : "TBD",
            },
            filter: null,
            liveScore: { status: mlbGame.status, homeScore: mlbGame.homeScore, awayScore: mlbGame.awayScore, inning: mlbGame.inning, inningHalf: mlbGame.inningHalf },
          };
        }).filter(Boolean)
      : oddsGames.map(game => buildPick(game, null, null)).filter(Boolean);

    results.sort((a, b) => b.edge - a.edge);

    const { safeCard, balancedCard, aggressiveCard } = buildParlayCards(results);

    // Only cache today's picks — future dates have moving odds/pitchers and should
    // always be fetched fresh. Caching them would block the cron from adding breakdowns.
    if (results.length && date === today) {
      await supabase
        .from("picks_cache")
        .upsert({ date, picks: results, generated_at: new Date().toISOString() }, { onConflict: "date" });
    }

    return Response.json({ picks: results, safeCard, balancedCard, aggressiveCard, cached: false });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
