// lib/backtest/tier3-runner.js
//
// Tier 3: replays the REAL production filter engine (lib/filter.js's
// applyFilterLayer) and Kelly sizing (lib/kelly.js's recommendedBetSize)
// against the 2025 season — the one season with real historical market
// odds in this repo (see lib/backtest/odds-loader.js). Follows the exact
// pick/filter wiring app/api/picks/route.js uses in production:
//   - modelProbRaw = getModelProbability(game, mlb)      [unblended]
//   - pick is whichever side modelProbRaw favors vs the market's fair
//     implied probability (equivalent to production's 20%-blended
//     direction check — the blend factor cancels out of the sign)
//   - applyFilterLayer is called with modelProbRaw (NOT the blended value)
//     per production's own comment: "Filter uses RAW model probability —
//     it has its own shrinkFactor calibration"
//
// Games with no matched real odds row are excluded from the sample (not
// backfilled with a synthetic line) — the exclusion rate is reported.

import { buildSeasonFeatures } from "./season-stats.js";
import { loadHistoricalOdds } from "./odds-loader.js";
import { getModelProbability, setEloRatings } from "../probability.js";
import { computeWalkForwardElo } from "./elo-walkforward.js";
import { applyFilterLayer } from "../filter.js";
import { recommendedBetSize } from "../kelly.js";
import { readFileSync } from "fs";
import { join } from "path";

const STARTING_BANKROLL = 1000;

export function runTier3({ season = "2025" } = {}) {
  const officialGames = JSON.parse(readFileSync(join(process.cwd(), "data/games.json"), "utf8"));
  const { perGame: eloPerGame } = computeWalkForwardElo(officialGames);
  const oddsByKey = loadHistoricalOdds();

  const seasonFeatures = buildSeasonFeatures().filter(f => f.date.slice(0, 4) === season);

  // Same date+home+away join queue pattern as tier2-runner.js, so
  // doubleheaders line up in encounter order against the official record.
  const officialQueues = new Map();
  officialGames.forEach((g, i) => {
    const key = `${g.date}|${g.homeCode}|${g.awayCode}`;
    const arr = officialQueues.get(key) ?? [];
    arr.push(i);
    officialQueues.set(key, arr);
  });

  let bankroll = STARTING_BANKROLL;
  const rows = [];
  let noOddsMatch = 0;

  for (const feat of seasonFeatures) {
    const officialKey = `${feat.date}|${feat.homeTeamCode}|${feat.awayTeamCode}`;
    const officialIdx = officialQueues.get(officialKey)?.shift();
    if (officialIdx == null) continue;
    const official = officialGames[officialIdx];
    const elo = eloPerGame[officialIdx];

    const oddsKey = `${feat.date}|${official.homeTeam}|${official.awayTeam}`;
    const odds = oddsByKey.get(oddsKey)?.shift();
    if (!odds) { noOddsMatch += 1; continue; }

    setEloRatings({ [official.homeTeam]: elo.preGameHomeElo, [official.awayTeam]: elo.preGameAwayElo });
    const modelProbRaw = getModelProbability({ homeTeam: official.homeTeam, awayTeam: official.awayTeam }, feat.mlb);

    const pick = modelProbRaw >= odds.homeImplied ? official.homeTeam : official.awayTeam;
    const pickIsHome = pick === official.homeTeam;
    const game = { homeTeam: official.homeTeam, awayTeam: official.awayTeam, ...odds };
    const filter = applyFilterLayer(pick, game, feat.mlb, modelProbRaw);

    const isBet = ["CLEAN", "BET"].includes(filter.verdict);
    let betResult = "no_bet";
    let sizing = null;

    if (isBet) {
      const pickOdds = pickIsHome ? odds.homeOdds : odds.awayOdds;
      const decimalOdds = pickOdds > 0 ? (pickOdds / 100) + 1 : (100 / Math.abs(pickOdds)) + 1;
      sizing = recommendedBetSize(filter.trueEdgePct / 100, decimalOdds, bankroll);
      const stake = parseFloat(sizing.amount);
      const pickWon = pick === (official.homeWon ? official.homeTeam : official.awayTeam);
      betResult = pickWon ? "win" : "loss";
      bankroll += pickWon ? stake * (decimalOdds - 1) : -stake;
    }

    rows.push({
      date: feat.date,
      home_team: official.homeTeam,
      away_team: official.awayTeam,
      home_score: official.homeScore,
      away_score: official.awayScore,
      home_won: official.homeWon,
      model_home_prob: modelProbRaw,
      pick,
      verdict: filter.verdict,
      confidence: filter.confidence,
      true_edge_pct: filter.trueEdgePct,
      market_home_implied: odds.homeImplied,
      odds_source: odds.source,
      bet_result: betResult,
      bankroll_after: parseFloat(bankroll.toFixed(2)),
      features: { variance: filter.variance, halfSize: filter.halfSize },
    });
  }

  const settled = rows.filter(r => r.bet_result === "win" || r.bet_result === "loss");
  const wins = settled.filter(r => r.bet_result === "win").length;
  const roiPct = settled.length > 0 ? ((bankroll - STARTING_BANKROLL) / STARTING_BANKROLL) * 100 : null;

  let peak = STARTING_BANKROLL, maxDrawdownPct = 0;
  for (const r of rows) {
    peak = Math.max(peak, r.bankroll_after);
    maxDrawdownPct = Math.max(maxDrawdownPct, ((peak - r.bankroll_after) / peak) * 100);
  }

  const verdictBreakdown = ["CLEAN", "BET", "PASS", "TRAP"].map(verdict => {
    const slice = rows.filter(r => r.verdict === verdict);
    const sliceSettled = slice.filter(r => r.bet_result === "win" || r.bet_result === "loss");
    const sliceWins = sliceSettled.filter(r => r.bet_result === "win").length;
    return { verdict, n: slice.length, settled: sliceSettled.length, wins: sliceWins, winPct: sliceSettled.length > 0 ? (sliceWins / sliceSettled.length) * 100 : null };
  });

  return {
    tier: "roi_real_odds",
    seasonStart: rows[0]?.date ?? null,
    seasonEnd: rows[rows.length - 1]?.date ?? null,
    gameCount: rows.length,
    params: {
      season,
      oddsSource: "historical-shanemcd-2025",
      startingBankroll: STARTING_BANKROLL,
      excludedNoOddsMatch: noOddsMatch,
    },
    metrics: {
      gameCount: rows.length,
      excludedNoOddsMatch: noOddsMatch,
      betsPlaced: settled.length,
      wins,
      losses: settled.length - wins,
      winPct: settled.length > 0 ? (wins / settled.length) * 100 : null,
      finalBankroll: parseFloat(bankroll.toFixed(2)),
      roiPct,
      maxDrawdownPct: parseFloat(maxDrawdownPct.toFixed(2)),
      verdictBreakdown,
      equityCurve: rows.map((r, i) => ({ i, date: r.date, bankroll: r.bankroll_after })),
    },
    rows,
  };
}
