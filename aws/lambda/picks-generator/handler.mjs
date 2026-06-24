/**
 * Lambda handler for daily MLB picks generation.
 *
 * Triggered by SQS from the Vercel /api/cron/picks endpoint, which sends a
 * lightweight message and returns immediately. All the heavy work (odds fetch,
 * Claude batch call, Supabase writes) runs here without Vercel's timeout limit.
 *
 * Message body: { force?: "1" }
 */

import { createClient } from "@supabase/supabase-js";
import { fetchMLBOdds } from "../../../lib/odds.js";
import { calculateEdge } from "../../../lib/edge.js";
import { getModelProbability, setEloRatings } from "../../../lib/probability.js";
import { applyFilterLayer } from "../../../lib/filter.js";
import { getEloRatings } from "../../../lib/elo-db.js";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL;

const getSupabase = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

// ── Team matching ─────────────────────────────────────────────────────────────

function matchMLBGame(game, mlbGames, skipIndices = null) {
  const norm = (s) => (s || "").toLowerCase().trim();
  const lastWord = (s) => norm(s).split(" ").pop();
  const timeClose = (t1, t2) => {
    if (!t1 || !t2) return true;
    return Math.abs(new Date(t1) - new Date(t2)) < 12 * 3_600_000;
  };
  const ok = (i) => !skipIndices?.has(i);

  let idx = mlbGames.findIndex(
    (g, i) =>
      ok(i) &&
      norm(g.homeTeam) === norm(game.homeTeam) &&
      norm(g.awayTeam) === norm(game.awayTeam) &&
      timeClose(g.commenceTime, game.commenceTime)
  );
  if (idx >= 0) return { match: mlbGames[idx], idx };

  idx = mlbGames.findIndex(
    (g, i) =>
      ok(i) &&
      norm(g.homeTeam).includes(lastWord(game.homeTeam)) &&
      norm(g.awayTeam).includes(lastWord(game.awayTeam)) &&
      timeClose(g.commenceTime, game.commenceTime)
  );
  if (idx >= 0) return { match: mlbGames[idx], idx };

  idx = mlbGames.findIndex((g, i) => {
    const hw = norm(game.homeTeam).split(" ").slice(-2).join(" ");
    const aw = norm(game.awayTeam).split(" ").slice(-2).join(" ");
    return (
      ok(i) &&
      norm(g.homeTeam).includes(hw) &&
      norm(g.awayTeam).includes(aw) &&
      timeClose(g.commenceTime, game.commenceTime)
    );
  });

  return idx >= 0 ? { match: mlbGames[idx], idx } : { match: null, idx: -1 };
}

// ── Claude batch call ─────────────────────────────────────────────────────────

async function callClaudeBatch(gameContexts) {
  const prompt = `You are a sharp MLB betting analyst. Direct, honest, no hype. You understand that MLB has enormous variance and even strong edges lose frequently.

RULES — never violate these:
- Do NOT lead with pitcher ERA comparison as the main reason to bet. Pitching is one factor among many.
- Do NOT treat a SP ERA/WHIP mismatch as the decisive edge unless sample size is large (50+ IP).
- Flag any pitcher with under 40 IP as "small sample — stats not stable."
- Bullpens finish ~40% of outs. Always note bullpen state if data is provided.
- Offensive strength (OPS, run production) matters equally to pitching. Note it.
- Edge % is a model estimate, NOT a calibrated probability. Never present it as precise.
- MLB variance is extreme. Every pick can lose regardless of edge. Say so when honest_lean is written.

Analyze these games. Return a JSON array — one object per game, same order.

${gameContexts
  .map(
    (g, i) => `
GAME ${i + 1}: ${g.awayTeam} @ ${g.homeTeam}
  Odds: home ${g.homeOdds > 0 ? "+" : ""}${g.homeOdds} / away ${g.awayOdds > 0 ? "+" : ""}${g.awayOdds}
  Pick: ${g.pick} | True edge: ${g.trueEdgePct}% | Verdict: ${g.verdict} | Variance: ${g.variance}
  Flags: ${g.flags || "none"} | Park: ${g.parkFactor > 0 ? "+" : ""}${g.parkFactor} runs
  ${g.homeTeam} SP: ${g.homePStr}
  ${g.awayTeam} SP: ${g.awayPStr}
  ${g.homeTeam} bullpen: ${g.homeBullpenStr}
  ${g.awayTeam} bullpen: ${g.awayBullpenStr}
  ${g.homeTeam} record: ${g.homeRecordStr} | lineup vs pitcher: ${g.homeLineupStr}
  ${g.awayTeam} record: ${g.awayRecordStr} | lineup vs pitcher: ${g.awayLineupStr}
  ${g.homeTeam} last 10: ${g.homeFormStr}
  ${g.awayTeam} last 10: ${g.awayFormStr}`
  )
  .join("\n")}

Return ONLY a JSON array, no markdown. Each element:
{
  "preview": "2 sentences. Name pitchers but don't make SP the only story. Lead with the strongest signal — offense, bullpen, or edge. Flag small samples.",
  "form_home": "1 sentence home team offense with OPS/runs numbers, or 'no data'",
  "form_away": "1 sentence away team offense with OPS/runs numbers, or 'no data'",
  "what_decides": "1 sentence — single factor (bullpen, lineup depth, park, or SP — pick the real one)",
  "what_to_sweat": "1 sentence — biggest risk to this pick losing, including MLB variance",
  "honest_lean": "1-2 sentences blunt take. Say if edge is thin noise or real signal. Remind that all MLB picks carry variance.",
  "score_range": "e.g. 5-3",
  "tier": { "level": "High" }
}`;

  let res, data;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 16000,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    data = await res.json();
  } catch (e) {
    console.warn("[claude] fetch failed, using stub breakdowns:", e.message);
    return gameContexts.map(() => null);
  }

  if (!res.ok || data.error) {
    console.warn(
      "[claude] API error, using stub breakdowns:",
      JSON.stringify(data.error || data).slice(0, 200)
    );
    return gameContexts.map(() => null);
  }

  const text = data.content?.[0]?.text || "[]";
  const clean = text.replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(clean);
  } catch {
    const partial = [];
    const objRe = /\{[^{}]*(?:\{[^{}]*\}[^{}]*)?\}/g;
    for (const m of clean.matchAll(objRe)) {
      try {
        partial.push(JSON.parse(m[0]));
      } catch {}
    }
    if (partial.length) {
      console.warn(
        `[claude] partial parse: got ${partial.length} of ${gameContexts.length} breakdowns`
      );
      return partial;
    }
    console.warn("[claude] invalid JSON, using stub breakdowns");
    return gameContexts.map(() => null);
  }
}

// ── Pick builder ──────────────────────────────────────────────────────────────

function buildPick(game, mlb, breakdown, precomputedFilter) {
  const modelProbRaw = getModelProbability(game, mlb);
  const homeImplied = game.homeImplied || 0.5;
  const modelProb = homeImplied + (modelProbRaw - homeImplied) * 0.2;
  const rawEdge = calculateEdge(modelProb, homeImplied);
  const pick = rawEdge >= 0 ? game.homeTeam : game.awayTeam;

  const filter =
    precomputedFilter ||
    applyFilterLayer(pick, { ...game, source: game.source }, mlb, modelProbRaw);
  const filteredIsBet = ["CLEAN", "BET"].includes(filter.verdict);
  const edgePct = filter.trueEdgePct;

  const verdictTier = filteredIsBet
    ? filter?.verdict === "CLEAN" || (filter?.confidence || 0) >= 7.5
      ? { level: "High", label: "🔥 Value Pick", emoji: "🔥" }
      : (filter?.confidence || 0) >= 6.5
      ? { level: "Medium", label: "✅ Solid Pick", emoji: "✅" }
      : { level: "Low", label: "👀 Lean", emoji: "👀" }
    : { level: "Low", label: "👀 Lean", emoji: "👀" };

  const tier = breakdown?.tier?.level
    ? {
        label:
          breakdown.tier.level === "High"
            ? "🔥 Value Pick"
            : breakdown.tier.level === "Medium"
            ? "✅ Solid Pick"
            : "👀 Lean",
        level: breakdown.tier.level,
        emoji:
          breakdown.tier.level === "High"
            ? "🔥"
            : breakdown.tier.level === "Medium"
            ? "✅"
            : "👀",
      }
    : verdictTier;

  const ipStr = (p) => (p?.inningsPitched ? ` ${p.inningsPitched} IP` : "");
  const hp = mlb?.homePitcher;
  const ap = mlb?.awayPitcher;
  const homePStr = hp
    ? `${hp.name} (${hp.wins}-${hp.losses}, ${hp.era} ERA, ${hp.whip} WHIP${ipStr(hp)})`
    : "TBD";
  const awayPStr = ap
    ? `${ap.name} (${ap.wins}-${ap.losses}, ${ap.era} ERA, ${ap.whip} WHIP${ipStr(ap)})`
    : "N/A";

  return {
    id: game.id,
    homeTeam: game.homeTeam,
    awayTeam: game.awayTeam,
    commenceTime: mlb?.commenceTime || game.commenceTime,
    homeOdds: game.homeOdds,
    awayOdds: game.awayOdds,
    openHomeOdds: game.homeOdds,
    openAwayOdds: game.awayOdds,
    pick,
    edge: edgePct,
    isBet: filteredIsBet,
    tier,
    breakdown: { ...(breakdown || {}), pitcher_home: homePStr, pitcher_away: awayPStr },
    filter,
    liveScore: mlb
      ? {
          status: mlb.status,
          homeScore: mlb.homeScore,
          awayScore: mlb.awayScore,
          inning: mlb.inning,
          inningHalf: mlb.inningHalf,
        }
      : null,
  };
}

// ── Date helpers ──────────────────────────────────────────────────────────────

function ctDateStr(offset = 0) {
  const d = new Date(Date.now() + offset * 86_400_000);
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  return `${p.find((x) => x.type === "year").value}-${p.find((x) => x.type === "month").value}-${p.find((x) => x.type === "day").value}`;
}

// ── Core generation ───────────────────────────────────────────────────────────

async function generateForDate(date, oddsGames, supabase, force = false, isToday = true) {
  const { data: existing } = await supabase
    .from("picks_cache")
    .select("picks, generated_at")
    .eq("date", date)
    .single();

  const ctFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const cacheCtDate = existing?.generated_at
    ? (() => {
        const p = ctFormatter.formatToParts(new Date(existing.generated_at));
        return `${p.find((x) => x.type === "year").value}-${p.find((x) => x.type === "month").value}-${p.find((x) => x.type === "day").value}`;
      })()
    : null;

  if (!force && cacheCtDate === date && existing?.picks?.some((p) => p.breakdown?.preview)) {
    return { skipped: true, date };
  }

  if (!force && isToday && existing?.picks?.length >= 3) {
    const ctHour = parseInt(
      new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Chicago",
        hour: "numeric",
        hour12: false,
      }).format(new Date()),
      10
    );
    if (ctHour >= 13)
      return { skipped: true, date, reason: "games in progress — preserving today's cache" };
  }

  const mlbRes = await fetch(`${BASE_URL}/api/mlb?date=${date}`)
    .then((r) => r.json())
    .catch(() => ({}));
  const mlbGames = mlbRes?.games || [];

  const dateOdds = oddsGames.filter((game) => {
    if (!game.commenceTime) return false;
    const t = new Date(game.commenceTime);
    const utcDate = t.toISOString().split("T")[0];
    const ctParts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(t);
    const ctDate = `${ctParts.find((x) => x.type === "year").value}-${ctParts.find((x) => x.type === "month").value}-${ctParts.find((x) => x.type === "day").value}`;
    return utcDate === date || ctDate === date;
  });

  if (!dateOdds.length) return { skipped: true, date, reason: "no odds games for date" };
  if (!force && !isToday && dateOdds.length < 6)
    return {
      skipped: true,
      date,
      reason: "tomorrow slate incomplete (<6 games) — will cache at next run",
    };

  const ipStr = (p) => (p?.inningsPitched ? ` ${p.inningsPitched} IP` : "");
  const bullStr = (b) =>
    b
      ? `${b.era} ERA, ${b.whip ?? "?"} WHIP, K/9 ${b.k9 ?? "?"}${b.isRolling ? ` (${b.window}d rolling)` : " (season)"}`
      : "no data";

  const seen = new Map();
  const dedupedOdds = dateOdds.filter((game) => {
    const key = `${game.homeTeam}|${game.awayTeam}|${game.homeOdds}|${game.awayOdds}`;
    if (seen.has(key)) return false;
    seen.set(key, true);
    return true;
  });

  const usedMLBIndices = new Set();
  const gameContexts = dedupedOdds.map((game) => {
    const { match: mlb, idx: mlbIdx } = matchMLBGame(game, mlbGames, usedMLBIndices);
    if (mlbIdx >= 0) usedMLBIndices.add(mlbIdx);
    const modelProbRaw = getModelProbability(game, mlb);
    const homeImplied = game.homeImplied || 0.5;
    const modelProb = homeImplied + (modelProbRaw - homeImplied) * 0.2;
    const rawEdge = calculateEdge(modelProb, homeImplied);
    const pick = rawEdge >= 0 ? game.homeTeam : game.awayTeam;
    const filter = applyFilterLayer(pick, { ...game, source: game.source }, mlb, modelProbRaw);
    const hp = mlb?.homePitcher, ap = mlb?.awayPitcher;
    const hf = mlb?.homeForm, af = mlb?.awayForm;
    const hb = mlb?.homeBullpen, ab = mlb?.awayBullpen;
    const hs = mlb?.homeStandings, as_ = mlb?.awayStandings;
    const hlo = mlb?.homeLineupOpsVsPitcher, alo = mlb?.awayLineupOpsVsPitcher;
    return {
      game, mlb, pick,
      homePStr: hp ? `${hp.name} (${hp.wins}-${hp.losses}, ${hp.era} ERA, ${hp.whip} WHIP${ipStr(hp)})` : "TBD",
      awayPStr: ap ? `${ap.name} (${ap.wins}-${ap.losses}, ${ap.era} ERA, ${ap.whip} WHIP${ipStr(ap)})` : "N/A",
      homeFormStr: hf ? `${hf.avg} AVG, ${hf.ops} OPS, ${hf.homeRuns} HR, ${hf.runs} R` : "no data",
      awayFormStr: af ? `${af.avg} AVG, ${af.ops} OPS, ${af.homeRuns} HR, ${af.runs} R` : "no data",
      homeBullpenStr: bullStr(hb), awayBullpenStr: bullStr(ab),
      homeRecordStr: hs ? `${hs.wins}-${hs.losses}` : "no data",
      awayRecordStr: as_ ? `${as_.wins}-${as_.losses}` : "no data",
      homeLineupStr: hlo != null ? `${parseFloat(hlo).toFixed(3)} OPS vs pitcher hand` : "not posted",
      awayLineupStr: alo != null ? `${parseFloat(alo).toFixed(3)} OPS vs pitcher hand` : "not posted",
      homeTeam: game.homeTeam, awayTeam: game.awayTeam,
      homeOdds: game.homeOdds, awayOdds: game.awayOdds,
      filter,
      trueEdgePct: filter.trueEdgePct, verdict: filter.verdict,
      variance: filter.variance, parkFactor: filter.parkFactor,
      flags: filter.flags.map((f) => f.replace(/_/g, " ").toLowerCase()).join(", ") || "none",
    };
  });

  const breakdowns = await callClaudeBatch(gameContexts);

  const unsortedResults = gameContexts.map((ctx, i) =>
    buildPick(ctx.game, ctx.mlb, breakdowns[i] || {}, ctx.filter)
  );

  const { data: existingSettled } = await supabase
    .from("model_picks")
    .select("id")
    .eq("date", date)
    .in("result", ["win", "loss", "push"])
    .limit(1);

  if (!existingSettled?.length) {
    const pickRows = gameContexts
      .map((ctx, i) => {
        const result = unsortedResults[i];
        if (!result) return null;
        const pickIsHome = result.pick === result.homeTeam;
        const odds = pickIsHome ? result.homeOdds : result.awayOdds;
        const gameId = Buffer.from(`${date}|${result.homeTeam}|${result.awayTeam}`)
          .toString("base64")
          .replace(/[^a-z0-9]/gi, "")
          .slice(0, 32);
        const f = result.filter || {};
        const mlb = ctx.mlb || {};
        const pickBullpen = pickIsHome ? mlb.homeBullpen : mlb.awayBullpen;
        const pickForm = pickIsHome ? mlb.homeForm : mlb.awayForm;
        const pickLineup = pickIsHome
          ? mlb.homeLineupOpsVsPitcher
          : mlb.awayLineupOpsVsPitcher;
        const features = {
          confidence: f.confidence ?? null,
          variance: f.variance ?? null,
          snr: f.snr ?? null,
          true_edge_pct: f.trueEdgePct ?? null,
          true_win_prob_pct: f.trueWinProbPct ?? null,
          sharp_implied_pct: f.sharpImpliedPct ?? null,
          uncertainty_pct: f.uncertaintyPct ?? null,
          park_factor: f.parkFactor ?? null,
          line_signal: f.lineSignal ?? null,
          verdict: f.verdict ?? null,
          pick_pitcher_score: pickIsHome ? f.homePitcherScore : f.awayPitcherScore,
          opp_pitcher_score: pickIsHome ? f.awayPitcherScore : f.homePitcherScore,
          pick_bullpen_era: pickBullpen?.era != null ? parseFloat(pickBullpen.era) : null,
          pick_form_ops: pickForm?.ops != null ? parseFloat(pickForm.ops) : null,
          lineup_ops_vs_pitcher: pickLineup != null ? parseFloat(pickLineup) : null,
          half_size: f.halfSize ?? false,
          open_home_odds: result.homeOdds ?? null,
          open_away_odds: result.awayOdds ?? null,
        };
        return {
          date,
          game_id: gameId,
          home_team: ctx.game.homeTeam,
          away_team: ctx.game.awayTeam,
          pick: result.pick,
          odds: odds ?? null,
          edge: result.edge,
          tier: result.tier?.level || "Low",
          is_bet: result.isBet,
          result: "pending",
          features,
        };
      })
      .filter(Boolean);

    if (pickRows.length) {
      await supabase.from("model_picks").delete().eq("date", date);
      const { error: insErr } = await supabase.from("model_picks").insert(pickRows);
      if (insErr) {
        console.warn("[lambda] insert failed, retrying without features:", insErr.message);
        const rowsNoFeatures = pickRows.map(({ features: _f, ...r }) => r);
        await supabase.from("model_picks").insert(rowsNoFeatures);
      }
    }
  }

  const results = unsortedResults.filter(Boolean);
  const verdictRank = (v) => ({ CLEAN: 0, BET: 1, PASS: 2, TRAP: 3 }[v] ?? 4);
  results.sort((a, b) => {
    const vd = verdictRank(a.filter?.verdict) - verdictRank(b.filter?.verdict);
    if (vd !== 0) return vd;
    return (b.filter?.trueEdgePct || 0) - (a.filter?.trueEdgePct || 0);
  });

  const lockScore = (p) => {
    if (!["CLEAN", "BET"].includes(p.filter?.verdict)) return 0;
    return (p.filter?.confidence || 0) * Math.max(p.filter?.trueEdgePct || 0, 0);
  };
  const lockPick = results.reduce(
    (best, p) => (lockScore(p) > lockScore(best) ? p : best),
    results[0]
  );
  if (lockPick && lockScore(lockPick) > 0) lockPick.isLock = true;

  await supabase
    .from("picks_cache")
    .upsert(
      { date, picks: results, generated_at: new Date().toISOString() },
      { onConflict: "date" }
    );

  console.log(`[lambda] generated ${results.length} picks for ${date}`);
  return { date, count: results.length };
}

// ── Lambda entry point ────────────────────────────────────────────────────────

export async function handler(event) {
  const failures = [];

  for (const record of event.Records) {
    try {
      const body = JSON.parse(record.body);
      const force = body.force === "1" || body.force === true;

      const today = ctDateStr(0);
      const tomorrow = ctDateStr(1);

      const supabase = getSupabase();
      const [oddsGames, liveElo] = await Promise.all([
        fetchMLBOdds(),
        getEloRatings(supabase),
      ]);
      setEloRatings(liveElo);

      const todayResult = await generateForDate(today, oddsGames, supabase, force, true);
      const tomorrowResult = await generateForDate(tomorrow, oddsGames, supabase, force, false);

      console.log("[lambda] done", { today: todayResult, tomorrow: tomorrowResult });
    } catch (err) {
      console.error("[lambda] record failed:", err.message, err.stack);
      // Report failure back to SQS so the message goes to the DLQ for inspection.
      failures.push({ itemIdentifier: record.messageId });
    }
  }

  // ReportBatchItemFailures — only failed messages go to DLQ, successful ones are deleted.
  return failures.length ? { batchItemFailures: failures } : {};
}
