import { createClient } from "@supabase/supabase-js";
import { fetchNFLOdds } from "../../../../lib/nfl-odds.js";
import { buildNFLPicksForGames } from "../../../../lib/nfl-picks.js";
import { requirePro } from "../../../../lib/auth.js";

// Server-side route — use service role key to bypass RLS on nfl_picks_cache reads
const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const ODDS_CACHE_KEY = "__odds__";
const ODDS_TTL_MS = 1000 * 60 * 15; // 15 min

// Supabase-backed cross-instance odds cache, same shape as app/api/picks/route.js's
// fetchOddsWithCache — avoids redundant TOA calls on cold starts.
async function fetchNFLOddsWithCache(supabase) {
  const { data: sbCached } = await supabase
    .from("nfl_picks_cache")
    .select("picks, generated_at")
    .eq("date", ODDS_CACHE_KEY)
    .single();

  if (sbCached?.picks?.length) {
    const age = Date.now() - new Date(sbCached.generated_at).getTime();
    if (age < ODDS_TTL_MS) return sbCached.picks;
  }

  try {
    const games = await fetchNFLOdds();
    if (games?.length) {
      supabase
        .from("nfl_picks_cache")
        .upsert({ date: ODDS_CACHE_KEY, picks: games, generated_at: new Date().toISOString() }, { onConflict: "date" })
        .then(() => {}).catch(e => console.warn("[nfl-odds] Supabase write failed:", e.message));
      return games;
    }
  } catch (e) {
    console.warn("[nfl-odds] live fetch failed:", e.message);
  }

  if (sbCached?.picks?.length) {
    console.warn("[nfl-odds] serving stale Supabase cache");
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
    const ctParts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(new Date());
    const today = `${ctParts.find(p => p.type === "year").value}-${ctParts.find(p => p.type === "month").value}-${ctParts.find(p => p.type === "day").value}`;
    const dateParam = searchParams.get("date");
    if (dateParam && !/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      return Response.json({ error: "invalid date" }, { status: 400 });
    }
    const date = dateParam || today;
    const bust = searchParams.get("bust") === "1";

    const { data: cached } = await supabase
      .from("nfl_picks_cache")
      .select("picks, generated_at")
      .eq("date", date)
      .single();

    const ctFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
    });
    const ctPartsOf = (iso) => {
      const p = ctFormatter.formatToParts(new Date(iso));
      return `${p.find(x => x.type === "year").value}-${p.find(x => x.type === "month").value}-${p.find(x => x.type === "day").value}`;
    };
    const cacheCtDate = cached?.generated_at ? ctPartsOf(cached.generated_at) : null;
    const cacheStale = cacheCtDate && cacheCtDate !== date;
    const isFutureDate = date > today;

    // No cron in Phase 1 — cache is populated by the admin regen endpoint. Serve
    // cache as-is for today/past dates; no live-score overlay yet (fast-follow).
    if (!bust && !cacheStale && !isFutureDate && cached?.picks?.length) {
      return Response.json({ picks: cached.picks, cached: true, generated_at: cached.generated_at });
    }

    // Past date with no cache — no historical NFL result source built yet in Phase 1.
    if (date < today && !cached?.picks?.length) {
      return Response.json({ picks: [], cached: false, notice: "no data for this date" });
    }

    const oddsGames = await fetchNFLOddsWithCache(supabase);
    if (!oddsGames.length) {
      return Response.json({ picks: [], cached: false, notice: "no NFL games/odds available" });
    }

    const results = await buildNFLPicksForGames(oddsGames, supabase);

    if (results.length && date === today) {
      await supabase
        .from("nfl_picks_cache")
        .upsert({ date, picks: results, generated_at: new Date().toISOString() }, { onConflict: "date" });
    }

    return Response.json({ picks: results, cached: false });
  } catch (e) {
    console.error("[nfl-picks] error:", e);
    return Response.json({ error: e.message }, { status: 500 });
  }
}
