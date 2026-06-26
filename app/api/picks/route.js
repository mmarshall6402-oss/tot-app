import { createClient } from "@supabase/supabase-js";
import { fetchMLBOdds } from "../../../lib/odds.js";
import { calculateEdge, getConfidenceTier, americanToDecimal, decimalToImplied, removeVig } from "../../../lib/edge.js";
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
  return {
    id: game.id, homeTeam: game.homeTeam, awayTeam: game.awayTeam,
    homeRecord: fmtRecord(mlb?.homeStandings), awayRecord: fmtRecord(mlb?.awayStandings),
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

const ODDS_CACHE_KEY = "__odds__";
const ODDS_TTL_MS = 1000 * 60 * 15; // 15 min

async function fetchOddsWithCache() {
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
    const dateParam = searchParams.get("date");
    if (dateParam && !/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      return Response.json({ error: "invalid date" }, { status: 400 });
    }
    const date = dateParam || today;
    const bust = searchParams.get("bust") === "1";

    const { data: cached } = await supabase
      .from("picks_cache")
      .select("picks, generated_at")
      .eq("date", date)
      .single();

    // Staleness check: if the cache was generated on a different CT day than the
    // requested date it's a stale "tomorrow" cache — treat as a miss so the fast
    // path rebuilds with today's full MLB schedule instead.
    const ctFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
    });
    const ctPartsOf = (iso) => {
      const p = ctFormatter.formatToParts(new Date(iso));
      return `${p.find(x=>x.type==="year").value}-${p.find(x=>x.type==="month").value}-${p.find(x=>x.type==="day").value}`;
    };
    const cacheCtDate = cached?.generated_at ? ctPartsOf(cached.generated_at) : null;
    const cacheStale  = cacheCtDate && cacheCtDate !== date;

    // Serve from cache for today AND past dates the cron populated.
    // Future dates always bypass cache — lines open throughout the day and we
    // want new games to appear immediately, not wait for the next cron run.
    // Past games hit the gameStarted lock (status === "Final") so the filter
    // verdict is preserved as-is; only the liveScore overlay updates.
    const isFutureDate = date > today;
    if (!bust && !cacheStale && !isFutureDate && cached?.picks?.length) {
      // Fetch fresh MLB data and live odds in parallel.
      // MLB: update live scores, pitchers, recompute filter (pitchers post ~90 min before first pitch).
      // Odds: update homeOdds/awayOdds to current line — enables closing line signal vs openHomeOdds stored at cron time.
      const [mlbRes, liveOdds] = await Promise.all([
        fetch(`${BASE_URL}/api/mlb?date=${date}`).then(r => r.json()).catch(() => ({ games: [] })),
        date >= today ? fetchOddsWithCache().catch(() => []) : Promise.resolve([]),
      ]);
      const mlbGames = mlbRes?.games || [];
      const normM = s => (s || "").toLowerCase().trim();
      const lwM   = s => normM(s).split(" ").pop();
      const skipM = new Set(["the","los","san","new","york","city"]);
      const matchTeamsM = (a, b) => {
        const an = normM(a), bn = normM(b);
        if (an === bn) return true;
        if (an.includes(lwM(bn)) || bn.includes(lwM(an))) return true;
        const tail = s => normM(s).split(" ").slice(-2).join(" ");
        if (an.includes(tail(bn)) || bn.includes(tail(an))) return true;
        const mw = s => normM(s).split(" ").filter(w => w.length > 3 && !skipM.has(w));
        return mw(bn).some(w => an.includes(w));
      };
      const findLiveOdds = (pick) => liveOdds.find(g =>
        matchTeamsM(g.homeTeam, pick.homeTeam) && matchTeamsM(g.awayTeam, pick.awayTeam)
      ) || null;
      const ipStr = (p) => p?.inningsPitched ? ` ${p.inningsPitched} IP` : "";
      const fmtRec = (s) => s ? `${s.wins}-${s.losses}` : null;
      // Build team-name → record map so we can overlay records even when matchMLBGame fails
      const teamRecordMap = new Map();
      for (const g of mlbGames) {
        if (g.homeStandings) teamRecordMap.set(normM(g.homeTeam), fmtRec(g.homeStandings));
        if (g.awayStandings) teamRecordMap.set(normM(g.awayTeam), fmtRec(g.awayStandings));
      }
      const lookupRecord = (name) => {
        const n = normM(name);
        if (teamRecordMap.has(n)) return teamRecordMap.get(n);
        for (const [k, v] of teamRecordMap) { if (k.includes(lwM(n)) || n.includes(lwM(k))) return v; }
        return null;
      };
      const picks = mlbGames.length
        ? cached.picks.map(pick => {
            const mlb = matchMLBGame(pick, mlbGames);
            if (!mlb) return {
              ...pick,
              homeRecord: pick.homeRecord ?? lookupRecord(pick.homeTeam),
              awayRecord: pick.awayRecord ?? lookupRecord(pick.awayTeam),
            };

            const homePStr = mlb.homePitcher ? `${mlb.homePitcher.name} (${mlb.homePitcher.wins}-${mlb.homePitcher.losses}, ${mlb.homePitcher.era} ERA, ${mlb.homePitcher.whip} WHIP${ipStr(mlb.homePitcher)})` : null;
            const awayPStr = mlb.awayPitcher ? `${mlb.awayPitcher.name} (${mlb.awayPitcher.wins}-${mlb.awayPitcher.losses}, ${mlb.awayPitcher.era} ERA, ${mlb.awayPitcher.whip} WHIP${ipStr(mlb.awayPitcher)})` : null;

            // Overlay current odds (closing line) while preserving opening odds for signal
            const currentOdds = findLiveOdds(pick);
            const freshHomeOdds = currentOdds?.homeOdds ?? pick.homeOdds;
            const freshAwayOdds = currentOdds?.awayOdds ?? pick.awayOdds;

            // Reconstruct homeImplied from current odds so model + filter run on live market
            let gameWithImplied = { ...pick, homeOdds: freshHomeOdds, awayOdds: freshAwayOdds };
            if (freshHomeOdds && freshAwayOdds) {
              const hDec = americanToDecimal(freshHomeOdds);
              const aDec = americanToDecimal(freshAwayOdds);
              const { fairHome, fairAway } = removeVig(decimalToImplied(hDec), decimalToImplied(aDec));
              gameWithImplied = { ...gameWithImplied, homeImplied: fairHome, awayImplied: fairAway };
            }

            const liveScore = { status: mlb.status, homeScore: mlb.homeScore, awayScore: mlb.awayScore, inning: mlb.inning, inningHalf: mlb.inningHalf };

            // Lock pick/filter/edge once the game has started — only overlay live score.
            // Re-running the model during a game shifts verdicts as in-game data changes,
            // which is misleading: the pre-game signal is what the bet was based on.
            const gameStarted = mlb.status === "Live" || mlb.status === "Final";
            if (gameStarted) {
              return {
                ...pick,
                homeRecord: fmtRec(mlb.homeStandings) ?? pick.homeRecord,
                awayRecord: fmtRec(mlb.awayStandings) ?? pick.awayRecord,
                liveScore,
                breakdown: {
                  ...pick.breakdown,
                  pitcher_home: homePStr || pick.breakdown?.pitcher_home,
                  pitcher_away: awayPStr || pick.breakdown?.pitcher_away,
                },
              };
            }

            const modelProbRaw  = getModelProbability(gameWithImplied, mlb);
            const homeImplied   = gameWithImplied.homeImplied || 0.5;
            const modelProb     = homeImplied + (modelProbRaw - homeImplied) * 0.20;
            const rawEdge       = calculateEdge(modelProb, homeImplied);
            const freshPick     = rawEdge >= 0 ? pick.homeTeam : pick.awayTeam;
            const freshFilter   = applyFilterLayer(freshPick, { ...gameWithImplied, source: pick.filter?.isSquareLine ? "sportsdata" : undefined }, mlb, modelProbRaw);
            const filteredIsBet = ["CLEAN", "BET"].includes(freshFilter.verdict);
            const edgePct       = freshFilter.trueEdgePct;
            const tier = pick.breakdown?.tier?.level
              ? { label: pick.breakdown.tier.level === "High" ? "🔥 Value Pick" : pick.breakdown.tier.level === "Medium" ? "✅ Solid Pick" : "👀 Lean", level: pick.breakdown.tier.level }
              : getConfidenceTier(edgePct / 100) || { label: "👀 Lean", level: "Low" };

            return {
              ...pick,
              pick: freshPick,
              homeOdds: freshHomeOdds,
              awayOdds: freshAwayOdds,
              homeRecord: fmtRec(mlb.homeStandings) ?? pick.homeRecord,
              awayRecord: fmtRec(mlb.awayStandings) ?? pick.awayRecord,
              edge: edgePct,
              isBet: filteredIsBet,
              tier,
              filter: freshFilter,
              liveScore,
              breakdown: {
                ...pick.breakdown,
                pitcher_home: homePStr || pick.breakdown?.pitcher_home,
                pitcher_away: awayPStr || pick.breakdown?.pitcher_away,
              },
            };
          })
        : cached.picks;

      // Add any MLB games that have no odds line and weren't in the cache
      if (mlbGames.length) {
        const norm2 = s => (s || "").toLowerCase().trim();
        const lw2   = s => norm2(s).split(" ").pop();
        const skip2 = new Set(["the","los","san","new","york","city"]);
        const covered2 = (p, g) => {
          const ph = norm2(p.homeTeam), pa = norm2(p.awayTeam);
          const gh = norm2(g.homeTeam), ga = norm2(g.awayTeam);
          if (ph === gh && pa === ga) return true;
          if (ph.includes(lw2(gh)) && pa.includes(lw2(ga))) return true;
          const tail = s => norm2(s).split(" ").slice(-2).join(" ");
          if (ph.includes(tail(gh)) && pa.includes(tail(ga))) return true;
          const mw = s => norm2(s).split(" ").filter(w => w.length > 3 && !skip2.has(w));
          return mw(gh).some(w => ph.includes(w)) && mw(ga).some(w => pa.includes(w));
        };
        const uncovered = mlbGames.filter(g => !picks.some(p => covered2(p, g)));
        for (const g of uncovered) {
          const ipStr2 = (p) => p?.inningsPitched ? ` ${p.inningsPitched} IP` : "";
          const isPastGame = g.status === "Final" || g.status === "Completed" || date < today;
          // Check if live odds now have a line for this game (e.g. via ESPN fallback)
          const oddsMatch = liveOdds.find(o =>
            matchTeamsM(o.homeTeam, g.homeTeam) && matchTeamsM(o.awayTeam, g.awayTeam)
          );
          if (oddsMatch && !isPastGame) {
            // We have odds — run the full model so this shows a real verdict instead of No Line
            const built = buildPick({ ...oddsMatch, commenceTime: g.commenceTime }, g, null);
            if (built) { picks.push(built); continue; }
          }
          // No odds anywhere — show as informational only
          const modelProb = getModelProbability({ homeTeam: g.homeTeam, awayTeam: g.awayTeam, homeImplied: 0.5, commenceTime: g.commenceTime }, g);
          const rawPick = modelProb >= 0.5 ? g.homeTeam : g.awayTeam;
          const fmtR = (s) => s ? `${s.wins}-${s.losses}` : null;
          picks.push({
            id: String(g.gameId),
            homeTeam: g.homeTeam, awayTeam: g.awayTeam,
            homeRecord: fmtR(g.homeStandings), awayRecord: fmtR(g.awayStandings),
            commenceTime: g.commenceTime,
            homeOdds: null, awayOdds: null,
            pick: rawPick, edge: 0, isBet: false,
            tier: isPastGame
              ? { label: "📋 Result", level: "Low", emoji: "📋" }
              : { label: "📋 No Line", level: "Low", emoji: "📋" },
            breakdown: {
              pitcher_home: g.homePitcher ? `${g.homePitcher.name} (${g.homePitcher.wins}-${g.homePitcher.losses}, ${g.homePitcher.era} ERA${ipStr2(g.homePitcher)})` : "TBD",
              pitcher_away: g.awayPitcher ? `${g.awayPitcher.name} (${g.awayPitcher.wins}-${g.awayPitcher.losses}, ${g.awayPitcher.era} ERA${ipStr2(g.awayPitcher)})` : "TBD",
            },
            filter: null,
            liveScore: { status: g.status, homeScore: g.homeScore, awayScore: g.awayScore, inning: g.inning, inningHalf: g.inningHalf },
          });
        }
      }

      // Sort: CLEAN first, then BET, then PASS, then TRAP — by edge within each group
      const verdictRank = v => ({ CLEAN: 0, BET: 1, PASS: 2, TRAP: 3 }[v] ?? 4);
      picks.sort((a, b) => {
        const betDiff = (b.isBet ? 1 : 0) - (a.isBet ? 1 : 0);
        if (betDiff !== 0) return betDiff;
        const vd = verdictRank(a.filter?.verdict) - verdictRank(b.filter?.verdict);
        if (vd !== 0) return vd;
        return (b.filter?.trueEdgePct || 0) - (a.filter?.trueEdgePct || 0);
      });

      // Lock pick: highest-conviction CLEAN/BET pick (confidence × edge).
      // Pass through isLock from cache, or re-derive from freshly computed filters.
      const anyLocked = picks.some(p => p.isLock);
      if (!anyLocked) {
        const lockScore = p => {
          if (!["CLEAN", "BET"].includes(p.filter?.verdict)) return 0;
          return (p.filter?.confidence || 0) * Math.max(p.filter?.trueEdgePct || 0, 0);
        };
        const lockPick = picks.reduce((best, p) => lockScore(p) > lockScore(best) ? p : best, picks[0]);
        if (lockPick && lockScore(lockPick) > 0) lockPick.isLock = true;
      }

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
          const fmtRec = (s) => s ? `${s.wins}-${s.losses}` : null;
          return {
            id: String(g.gameId),
            homeTeam: g.homeTeam, awayTeam: g.awayTeam,
            homeRecord: fmtRec(g.homeStandings), awayRecord: fmtRec(g.awayStandings),
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
    // Multi-strategy matching: last word → 2-word suffix → any shared meaningful token
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
    const findOdds = (mlbGame) => oddsGames.find(g =>
      matchTeams(g.homeTeam, mlbGame.homeTeam) &&
      matchTeams(g.awayTeam, mlbGame.awayTeam)
    ) || null;

    const ipStr2 = (p) => p?.inningsPitched ? ` ${p.inningsPitched} IP` : "";

    const results = mlbGames.length
      ? mlbGames.map(mlbGame => {
          const oddsGame = findOdds(mlbGame);
          if (oddsGame) {
            return buildPick({ ...oddsGame, commenceTime: mlbGame.commenceTime }, mlbGame, null);
          }
          // No odds yet — show the game card with pitcher matchup but no pick/edge.
          const modelProb = getModelProbability({ homeTeam: mlbGame.homeTeam, awayTeam: mlbGame.awayTeam, homeImplied: 0.5, commenceTime: mlbGame.commenceTime }, mlbGame);
          const pick = modelProb >= 0.5 ? mlbGame.homeTeam : mlbGame.awayTeam;
          const isStarted = mlbGame.status === "Live" || mlbGame.status === "Final" || mlbGame.status === "Completed";
          const fmtRec2 = (s) => s ? `${s.wins}-${s.losses}` : null;
          return {
            id: String(mlbGame.gameId), homeTeam: mlbGame.homeTeam, awayTeam: mlbGame.awayTeam,
            homeRecord: fmtRec2(mlbGame.homeStandings), awayRecord: fmtRec2(mlbGame.awayStandings),
            commenceTime: mlbGame.commenceTime, homeOdds: null, awayOdds: null,
            pick, edge: 0, isBet: false,
            tier: isStarted
              ? { label: "📋 Result",  level: "Low", emoji: "📋" }
              : { label: "📋 No Line", level: "Low", emoji: "📋" },
            breakdown: {
              pitcher_home: mlbGame.homePitcher ? `${mlbGame.homePitcher.name} (${mlbGame.homePitcher.wins}-${mlbGame.homePitcher.losses}, ${mlbGame.homePitcher.era} ERA${ipStr2(mlbGame.homePitcher)})` : "TBD",
              pitcher_away: mlbGame.awayPitcher ? `${mlbGame.awayPitcher.name} (${mlbGame.awayPitcher.wins}-${mlbGame.awayPitcher.losses}, ${mlbGame.awayPitcher.era} ERA${ipStr2(mlbGame.awayPitcher)})` : "TBD",
            },
            filter: null,
            liveScore: { status: mlbGame.status, homeScore: mlbGame.homeScore, awayScore: mlbGame.awayScore, inning: mlbGame.inning, inningHalf: mlbGame.inningHalf },
          };
        }).filter(Boolean)
      : oddsGames.map(game => buildPick(game, null, null)).filter(Boolean);

    const verdictRank2 = v => ({ CLEAN: 0, BET: 1, PASS: 2, TRAP: 3 }[v] ?? 4);
    results.sort((a, b) => {
      const betDiff = (b.isBet ? 1 : 0) - (a.isBet ? 1 : 0);
      if (betDiff !== 0) return betDiff;
      const vd = verdictRank2(a.filter?.verdict) - verdictRank2(b.filter?.verdict);
      if (vd !== 0) return vd;
      return (b.filter?.trueEdgePct || 0) - (a.filter?.trueEdgePct || 0);
    });

    const { safeCard, balancedCard, aggressiveCard } = buildParlayCards(results);

    // Only cache today's picks — future dates have moving odds/pitchers and should
    // always be fetched fresh. Preserve any Claude breakdowns from the stale cache so
    // the live path doesn't wipe breakdown data written by yesterday's pre-cache run.
    if (results.length && date === today) {
      let picksToCache = results;
      if (cached?.picks?.some(p => p.breakdown?.preview)) {
        const bdMap = {};
        for (const p of cached.picks) {
          if (p.breakdown?.preview) bdMap[`${p.homeTeam}|${p.awayTeam}`] = p.breakdown;
        }
        picksToCache = results.map(r => {
          const bd = bdMap[`${r.homeTeam}|${r.awayTeam}`];
          if (!bd) return r;
          return { ...r, breakdown: { ...bd, pitcher_home: r.breakdown?.pitcher_home || bd.pitcher_home, pitcher_away: r.breakdown?.pitcher_away || bd.pitcher_away } };
        });
      }
      await supabase
        .from("picks_cache")
        .upsert({ date, picks: picksToCache, generated_at: new Date().toISOString() }, { onConflict: "date" });
    }

    return Response.json({ picks: results, safeCard, balancedCard, aggressiveCard, cached: false });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
