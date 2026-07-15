// lib/backtest/odds-loader.js
//
// Loads real historical MLB moneyline odds from data/odds/mlb_odds_2025.xlsx
// (a consensus-of-books MLB odds/results archive covering the full 2025
// regular season, 2,430 games — source: Shane McDonald, shanemcd.org).
// This is the one season with real market data in this repo; Tier 3's ROI
// backtest is necessarily scoped to it.
//
// Produces the exact {homeImplied, awayImplied, homeOdds, awayOdds, source}
// shape lib/filter.js's sharpImplied()/juiceCheck() expect. homeImplied/
// awayImplied are VIG-REMOVED fair probabilities — matching how
// app/api/picks/route.js itself populates `game.homeImplied` from live odds
// (see removeVig() call in that route), not the raw vig-included implied
// probability.

import XLSX from "xlsx";
import { join } from "path";
import { americanToDecimal, decimalToImplied, removeVig } from "../edge.js";

const ODDS_SOURCE = "historical-shanemcd-2025";

export function loadHistoricalOdds(path = join(process.cwd(), "data/odds/mlb_odds_2025.xlsx")) {
  const wb = XLSX.readFile(path);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets["Betting Odds"]);

  const byKey = new Map();
  for (const r of rows) {
    if (r.Status !== "Final") continue;
    const homeOdds = parseInt(r["Home ML"], 10);
    const awayOdds = parseInt(r["Away ML"], 10);
    if (isNaN(homeOdds) || isNaN(awayOdds)) continue;

    const homeImpliedRaw = decimalToImplied(americanToDecimal(homeOdds));
    const awayImpliedRaw = decimalToImplied(americanToDecimal(awayOdds));
    const { fairHome, fairAway } = removeVig(homeImpliedRaw, awayImpliedRaw);

    const date = r.Date.replace(/-/g, "");
    const key = `${date}|${r.Home}|${r.Away}`;
    // Doubleheaders: keep a queue per key, consumed in encounter order by
    // the runner (same join pattern used against data/games.json elsewhere).
    const arr = byKey.get(key) ?? [];
    arr.push({
      date,
      homeTeam: r.Home,
      awayTeam: r.Away,
      homeOdds,
      awayOdds,
      homeImplied: fairHome,
      awayImplied: fairAway,
      source: ODDS_SOURCE,
    });
    byKey.set(key, arr);
  }

  return byKey;
}
