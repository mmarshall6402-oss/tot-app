import { createClient } from "@supabase/supabase-js";
import { getOddsDiagnostics } from "../../../lib/odds.js";
import { calculateEdge, americanToDecimal, decimalToImplied, removeVig } from "../../../lib/edge.js";
import { getCalibratedModelProbability } from "../../../lib/probability.js";
import { applyFilterLayer, buildParlayCards } from "../../../lib/filter.js";
import { requirePro } from "../../../lib/auth.js";
import { buildPick, matchMLBGame, dedupeByMatchup, fetchOddsWithCache } from "../../../lib/mlb-picks.js";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
// Server-side route — use service role key to bypass RLS on picks_cache reads
const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export async function GET(request) {
  // requirePro runs before the main try/catch; if IT throws (e.g. a misconfigured
  // Supabase client), the whole invocation crashes to a platform HTML 500 that the
  // client can't parse. Guard it so auth failures are always a readable JSON error.
  let authError;
  try {
    ({ error: authError } = await requirePro(request));
  } catch (e) {
    return Response.json({ error: `Auth failed: ${e?.message || e?.name || "unknown"}` }, { status: 500 });
  }
  if (authError) return authError;

  try {
    const supabase = getSupabase();
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
      let picks = mlbGames.length
        ? cached.picks.map(pick => {
            const mlb = matchMLBGame(pick, mlbGames);
            // Drop ghost games: cached entry has no MLB schedule match and its
            // start time is already in the past — stale odds API line from a prior day.
            if (!mlb && pick.commenceTime && new Date(pick.commenceTime) < new Date()) return null;
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
                openHomeOdds: pick.homeOdds,
                openAwayOdds: pick.awayOdds,
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

            const modelProbRaw  = getCalibratedModelProbability(gameWithImplied, mlb);
            const homeImplied   = gameWithImplied.homeImplied || 0.5;
            const modelProb     = homeImplied + (modelProbRaw - homeImplied) * 0.20;
            const rawEdge       = calculateEdge(modelProb, homeImplied);
            // Lock pick direction when a Claude breakdown exists. The breakdown was written
            // for the original pick; flipping it via a small odds movement creates a direct
            // contradiction where the card says "Take A" but the breakdown argues for "Take B".
            const hasBreakdown  = !!pick.breakdown?.preview;
            const freshPick     = hasBreakdown ? pick.pick : (rawEdge >= 0 ? pick.homeTeam : pick.awayTeam);
            const freshFilter   = applyFilterLayer(freshPick, { ...gameWithImplied, source: pick.filter?.isSquareLine ? "sportsdata" : undefined }, mlb, modelProbRaw);
            const filteredIsBet = ["CLEAN", "BET"].includes(freshFilter.verdict);
            const edgePct       = freshFilter.trueEdgePct;
            // Always derive tier from the live filter — Claude's cron-time tier may conflict
            // with the CONFIDENCE/VARIANCE values shown in the expanded filter panel.
            const tier = filteredIsBet
              ? (freshFilter?.verdict === "CLEAN" || (freshFilter?.confidence || 0) >= 7.5)
                ? { level: "High",   label: "🔥 Value Pick", emoji: "🔥" }
                : (freshFilter?.confidence || 0) >= 6.5
                ? { level: "Medium", label: "✅ Solid Pick",  emoji: "✅" }
                : { level: "Low",    label: "👀 Lean",         emoji: "👀" }
              : { level: "Low",    label: "👀 Lean",           emoji: "👀" };

            const freshPickModelProb = freshPick === gameWithImplied.homeTeam ? modelProb : 1 - modelProb;
            return {
              ...pick,
              pick: freshPick,
              homeOdds: freshHomeOdds,
              awayOdds: freshAwayOdds,
              openHomeOdds: pick.homeOdds,
              openAwayOdds: pick.awayOdds,
              homeRecord: fmtRec(mlb.homeStandings) ?? pick.homeRecord,
              awayRecord: fmtRec(mlb.awayStandings) ?? pick.awayRecord,
              modelProb: Math.round(freshPickModelProb * 100),
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
          }).filter(Boolean)
        // mlbGames is empty — MLB's own schedule says zero games today (e.g. the
        // All-Star break). A cached pick can only be legitimate here if its own
        // commence time actually falls on `date`; otherwise it's a leftover entry
        // (e.g. a next-day game whose odds line had already posted) that would
        // otherwise render forever since there's no live schedule to invalidate it.
        : cached.picks.filter(pick => {
            if (!pick.commenceTime) return false;
            const utcDate = new Date(pick.commenceTime).toISOString().split("T")[0];
            return utcDate === date || ctPartsOf(pick.commenceTime) === date;
          });

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
          const modelProb = getCalibratedModelProbability({ homeTeam: g.homeTeam, awayTeam: g.awayTeam, homeImplied: 0.5, commenceTime: g.commenceTime }, g);
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

      picks = dedupeByMatchup(picks);

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
          const modelProb = getCalibratedModelProbability({ homeTeam: g.homeTeam, awayTeam: g.awayTeam, homeImplied: 0.5, commenceTime: g.commenceTime }, g);
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
      // .catch here matches the fast-path guard: a Supabase reject inside
      // fetchOddsWithCache must degrade to "no odds", not crash the whole route.
      fetchOddsWithCache().catch((e) => { console.warn("[picks] odds fetch failed:", e?.message); return []; }),
      fetch(`${BASE_URL}/api/mlb?date=${date}`).then(r => r.json()).catch(() => ({ games: [] })),
    ]);

    const mlbGames = mlbRes?.games || [];

    // fetchOddsWithCache() intentionally returns BOTH today's and tomorrow's lines
    // (sportsbooks post next-day odds early). Scope it down to `date` here so an
    // off day (All-Star break, rainout, etc. — zero games in the MLB schedule) can't
    // fall back to tomorrow's odds and render them as if they were today's games.
    const oddsForDate = oddsGames.filter(g => {
      if (!g.commenceTime) return false;
      const t = new Date(g.commenceTime);
      const utcDate = t.toISOString().split("T")[0];
      const ctParts = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
      }).formatToParts(t);
      const ctD = `${ctParts.find(x => x.type === "year").value}-${ctParts.find(x => x.type === "month").value}-${ctParts.find(x => x.type === "day").value}`;
      return utcDate === date || ctD === date;
    });

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
    const findOdds = (mlbGame) => oddsForDate.find(g =>
      matchTeams(g.homeTeam, mlbGame.homeTeam) &&
      matchTeams(g.awayTeam, mlbGame.awayTeam)
    ) || null;

    const ipStr2 = (p) => p?.inningsPitched ? ` ${p.inningsPitched} IP` : "";

    let results = mlbGames.length
      ? mlbGames.map(mlbGame => {
          const oddsGame = findOdds(mlbGame);
          if (oddsGame) {
            return buildPick({ ...oddsGame, commenceTime: mlbGame.commenceTime }, mlbGame, null);
          }
          // No odds yet — show the game card with pitcher matchup but no pick/edge.
          const modelProb = getCalibratedModelProbability({ homeTeam: mlbGame.homeTeam, awayTeam: mlbGame.awayTeam, homeImplied: 0.5, commenceTime: mlbGame.commenceTime }, mlbGame);
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
      : oddsForDate.map(game => buildPick(game, null, null)).filter(Boolean);

    results = dedupeByMatchup(results);

    const verdictRank2 = v => ({ CLEAN: 0, BET: 1, PASS: 2, TRAP: 3 }[v] ?? 4);
    results.sort((a, b) => {
      const betDiff = (b.isBet ? 1 : 0) - (a.isBet ? 1 : 0);
      if (betDiff !== 0) return betDiff;
      const vd = verdictRank2(a.filter?.verdict) - verdictRank2(b.filter?.verdict);
      if (vd !== 0) return vd;
      return (b.filter?.trueEdgePct || 0) - (a.filter?.trueEdgePct || 0);
    });

    const { safeCard, balancedCard, aggressiveCard } = buildParlayCards(results);

    // No games at all — surface why (bad odds keys, MLB schedule fetch failure,
    // or a genuine off day) instead of leaving the client to guess.
    const diagnostic = results.length ? undefined : {
      mlbSchedule: mlbRes?.error ? { ok: false, error: mlbRes.error } : { ok: true, games: mlbGames.length },
      odds: getOddsDiagnostics(),
    };

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

    return Response.json({ picks: results, safeCard, balancedCard, aggressiveCard, cached: false, ...(diagnostic ? { diagnostic } : {}) });
  } catch (e) {
    // Never return a blank/undefined-message 500 — that renders on the client as
    // the generic "the picks API crashed" with no clue why. Surface the real
    // error name/message/cause so it's diagnosable from the UI without log access.
    console.error("[picks] fatal:", e);
    const msg = e?.message || e?.cause?.message || (typeof e === "string" ? e : e?.name) || "unknown error";
    return Response.json({
      error: msg,
      name: e?.name,
      stack: typeof e?.stack === "string" ? e.stack.split("\n").slice(0, 4) : undefined,
    }, { status: 500 });
  }
}
