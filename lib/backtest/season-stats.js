// lib/backtest/season-stats.js
//
// Walk-forward feature builder: replays every parsed Retrosheet game in
// true chronological order and, for each game, snapshots a `mlb` object
// shaped exactly like what app/api/picks/route.js builds for the live
// model — built ENTIRELY from games strictly before the current one. This
// no-lookahead discipline is the single most important correctness
// property of the whole backtest: any feature computed using the current
// game's own plays (or a later game's) would leak the outcome into its own
// prediction and invalidate the result.
//
// Known, documented approximations (see AGENTS/plan for full context):
//  - `era` has no independent source (this parser doesn't reconstruct runs
//    scored/earned-run allocation) — it's set equal to the xFIP proxy, so
//    filter.js's ERA-vs-xFIP regression-gap flags never fire. The primary
//    probability signal is unaffected: probability.js prefers xFIP over ERA
//    whenever xFIP is present.
//  - hardHitPct / Savant wOBA are permanently unavailable from Retrosheet —
//    left null everywhere, which is already a documented no-op in both
//    probability.js and filter.js.
//  - Bullpen "fatigued" is shipped disabled (always false) for v1.
//  - `recentStarts` (last-5-starts blend) is omitted for v1 — probability.js
//    already falls back to the full-season score when it's absent.

import { parseEventFile } from "./retrosheet-parser.js";
import { loadRosters } from "./roster.js";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";

const FIP_CONSTANT = 3.10;
const FORM_WINDOW_LONG = 10;
const FORM_WINDOW_SHORT = 7;
const BULLPEN_WINDOW_DAYS = 14;

function emptyBatterBucket() {
  return { pa: 0, ab: 0, h1: 0, h2: 0, h3: 0, hr: 0, bb: 0, hbp: 0 };
}

function addBatterEvent(bucket, kind) {
  bucket.pa += 1;
  if (kind === "BB" || kind === "HBP") {
    if (kind === "HBP") bucket.hbp += 1; else bucket.bb += 1;
    return;
  }
  // AB excludes BB/HBP; SF (kind OUT with no batted-ball attribution beyond
  // "out") is approximated as counting toward AB, a standard simplification
  // when sac flies aren't separately tracked.
  bucket.ab += 1;
  if (kind === "1B") bucket.h1 += 1;
  else if (kind === "2B") bucket.h2 += 1;
  else if (kind === "3B") bucket.h3 += 1;
  else if (kind === "HR") bucket.hr += 1;
}

function opsFromBucket(b) {
  if (!b || b.pa === 0) return null;
  const hits = b.h1 + b.h2 + b.h3 + b.hr;
  const totalBases = b.h1 + b.h2 * 2 + b.h3 * 3 + b.hr * 4;
  const obp = (hits + b.bb + b.hbp) / b.pa;
  const slg = b.ab > 0 ? totalBases / b.ab : 0;
  return obp + slg;
}

function emptyPitcherBucket() {
  return { outs: 0, k: 0, bb: 0, hbp: 0, h1: 0, h2: 0, h3: 0, hr: 0, fb: 0, pa: 0 };
}

function addPitcherEvent(bucket, play) {
  bucket.outs += play.outs;
  if (!play.isPA) return;
  bucket.pa += 1;
  if (play.kind === "K") bucket.k += 1;
  else if (play.kind === "BB") bucket.bb += 1;
  else if (play.kind === "HBP") bucket.hbp += 1;
  else if (play.kind === "1B") bucket.h1 += 1;
  else if (play.kind === "2B") bucket.h2 += 1;
  else if (play.kind === "3B") bucket.h3 += 1;
  else if (play.kind === "HR") bucket.hr += 1;
  if (play.battedBallType === "F") bucket.fb += 1;
}

// leagueHrPerFb: walk-forward season-to-date league rate, so the xFIP
// proxy never uses this game's (or a future game's) own HR/FB data.
function snapshotPitcher(bucket, leagueHrPerFb) {
  if (!bucket || bucket.outs === 0) return null;
  const ip = bucket.outs / 3;
  const hits = bucket.h1 + bucket.h2 + bucket.h3 + bucket.hr;
  const whip = (bucket.bb + hits) / ip;
  const kBBPct = bucket.pa > 0 ? ((bucket.k - bucket.bb) / bucket.pa) * 100 : null;
  const xFip = ((13 * (leagueHrPerFb * bucket.fb) + 3 * (bucket.bb + bucket.hbp) - 2 * bucket.k) / ip) + FIP_CONSTANT;
  return {
    era: xFip, // documented proxy — no earned-run reconstruction, see file header
    whip,
    xFip,
    kBBPct,
    hardHitPct: null,
    inningsPitched: `${Math.floor(bucket.outs / 3)}.${bucket.outs % 3}`,
  };
}

function snapshotBullpen(bucket, leagueHrPerFb) {
  if (!bucket || bucket.outs === 0) return null;
  const ip = bucket.outs / 3;
  const hits = bucket.h1 + bucket.h2 + bucket.h3 + bucket.hr;
  return {
    era: ((13 * (leagueHrPerFb * bucket.fb) + 3 * (bucket.bb + bucket.hbp) - 2 * bucket.k) / ip) + FIP_CONSTANT,
    whip: (bucket.bb + hits) / ip,
    k9: (bucket.k / ip) * 9,
    isRolling: true,
    fatigued: false, // shipped disabled for v1 — see file header
    eraInflation: 0,
  };
}

function loadTeamCrosswalk() {
  const games = JSON.parse(readFileSync(join(process.cwd(), "data/games.json"), "utf8"));
  const map = new Map();
  for (const g of games) {
    map.set(g.homeCode, g.homeTeam);
    map.set(g.awayCode, g.awayTeam);
  }
  return map;
}

// Retrosheet event files carry no run-scoring reconstruction in this parser
// (see retrosheet-events.js header), so standings win/loss must come from
// data/games.json's authoritative homeWon — keyed by date+home+away, same
// join key already validated 1:1 against every parsed Retrosheet game.
function loadGameOutcomes() {
  const games = JSON.parse(readFileSync(join(process.cwd(), "data/games.json"), "utf8"));
  const map = new Map();
  for (const g of games) {
    map.set(`${g.date}|${g.homeCode}|${g.awayCode}`, g.homeWon);
  }
  return map;
}

function loadAllGamesChronological() {
  const dir = join(process.cwd(), "data/retrosheet");
  const files = readdirSync(dir).filter(f => f.endsWith(".EVA") || f.endsWith(".EVN"));
  const games = [];
  for (const file of files) {
    const text = readFileSync(join(dir, file), "utf8");
    games.push(...parseEventFile(text));
  }
  games.sort((a, b) => (a.date === b.date ? a.gameId.localeCompare(b.gameId) : a.date.localeCompare(b.date)));
  return games;
}

// Returns an array of { gameId, date, homeTeamCode, awayTeamCode, homeTeamName,
// awayTeamName, mlb }, one per Retrosheet game, in chronological order, with
// `mlb` built strictly from state as of the day before that game.
export function buildSeasonFeatures() {
  const games = loadAllGamesChronological();
  const rosters = loadRosters();
  const crosswalk = loadTeamCrosswalk();
  const outcomes = loadGameOutcomes();

  let pitcherSeason = new Map(); // pitcherId -> bucket
  let bullpenLog = new Map();    // teamCode -> [{date, outs, k, bb, hbp, h1,h2,h3,hr, fb}]
  let teamGameLog = new Map();   // teamCode -> [{date, ...batterBucket}]
  let teamRecord = new Map();    // teamCode -> {wins, losses}
  let teamHandSplits = new Map(); // teamCode -> { vsL: bucket, vsR: bucket }
  let leagueFb = 0, leagueHr = 0;
  let currentSeasonYear = null;

  const results = [];

  for (const game of games) {
    // Every one of these is a "season-to-date" stat in real MLB terms — an
    // April 2023 game must not see stats accumulated during the 2022
    // season. Reset all walk-forward state at each year boundary. Elo is
    // deliberately excluded (handled separately in elo-walkforward.js) —
    // team strength genuinely does carry across seasons.
    const seasonYear = game.date.slice(0, 4);
    if (seasonYear !== currentSeasonYear) {
      currentSeasonYear = seasonYear;
      pitcherSeason = new Map();
      bullpenLog = new Map();
      teamGameLog = new Map();
      teamRecord = new Map();
      teamHandSplits = new Map();
      leagueFb = 0;
      leagueHr = 0;
    }

    const leagueHrPerFb = leagueFb > 0 ? leagueHr / leagueFb : 0.10; // ~10% league-average HR/FB as a cold-start seed

    const homeStarterSnap = snapshotPitcher(pitcherSeason.get(game.homeStarterId), leagueHrPerFb);
    const awayStarterSnap = snapshotPitcher(pitcherSeason.get(game.awayStarterId), leagueHrPerFb);

    const homeBullBucket = rollingBullpen(bullpenLog.get(game.homeTeamCode), game.date);
    const awayBullBucket = rollingBullpen(bullpenLog.get(game.awayTeamCode), game.date);

    const homeForm10 = rollingForm(teamGameLog.get(game.homeTeamCode), FORM_WINDOW_LONG);
    const awayForm10 = rollingForm(teamGameLog.get(game.awayTeamCode), FORM_WINDOW_LONG);
    const homeForm7 = rollingForm(teamGameLog.get(game.homeTeamCode), FORM_WINDOW_SHORT);
    const awayForm7 = rollingForm(teamGameLog.get(game.awayTeamCode), FORM_WINDOW_SHORT);

    const homeRec = teamRecord.get(game.homeTeamCode);
    const awayRec = teamRecord.get(game.awayTeamCode);

    const awayStarterHand = rosters.get(game.awayStarterId)?.throws;
    const homeStarterHand = rosters.get(game.homeStarterId)?.throws;
    const homeVsHand = handSplitBucket(teamHandSplits.get(game.homeTeamCode), awayStarterHand);
    const awayVsHand = handSplitBucket(teamHandSplits.get(game.awayTeamCode), homeStarterHand);

    const mlb = {
      homePitcher: homeStarterSnap,
      awayPitcher: awayStarterSnap,
      homeBullpen: snapshotBullpen(homeBullBucket, leagueHrPerFb),
      awayBullpen: snapshotBullpen(awayBullBucket, leagueHrPerFb),
      homeLineupOpsVsPitcher: opsFromBucket(homeVsHand),
      awayLineupOpsVsPitcher: opsFromBucket(awayVsHand),
      homeLineupSavant: null,
      awayLineupSavant: null,
      homeForm: homeForm10 ? { ops: homeForm10 } : null,
      awayForm: awayForm10 ? { ops: awayForm10 } : null,
      homeForm7d: homeForm7 ? { ops: homeForm7 } : null,
      awayForm7d: awayForm7 ? { ops: awayForm7 } : null,
      homeStandings: homeRec ? { winningPercentage: homeRec.wins / (homeRec.wins + homeRec.losses) } : null,
      awayStandings: awayRec ? { winningPercentage: awayRec.wins / (awayRec.wins + awayRec.losses) } : null,
    };

    results.push({
      gameId: game.gameId,
      date: game.date,
      homeTeamCode: game.homeTeamCode,
      awayTeamCode: game.awayTeamCode,
      homeTeamName: crosswalk.get(game.homeTeamCode) ?? game.homeTeamCode,
      awayTeamName: crosswalk.get(game.awayTeamCode) ?? game.awayTeamCode,
      mlb,
    });

    // ── Update all walk-forward state with THIS game's actual plays ──
    const homeBatting = emptyBatterBucket();
    const awayBatting = emptyBatterBucket();
    const homeBullGame = emptyPitcherBucket();
    const awayBullGame = emptyPitcherBucket();

    for (const play of game.plays) {
      if (!play.isPA && play.outs === 0) continue;

      // Pitcher stats (starter or reliever — whoever was on the mound)
      if (play.pitcherId) {
        const bucket = pitcherSeason.get(play.pitcherId) ?? emptyPitcherBucket();
        addPitcherEvent(bucket, play);
        pitcherSeason.set(play.pitcherId, bucket);

        const isStarter = play.pitcherId === (play.defendingTeam === "home" ? game.homeStarterId : game.awayStarterId);
        if (!isStarter) {
          const relBucket = play.defendingTeam === "home" ? homeBullGame : awayBullGame;
          addPitcherEvent(relBucket, play);
        }
      }
      if (!play.isPA) continue;

      // League-wide FB/HR tallies for next game's xFIP-proxy constant
      if (play.battedBallType === "F") leagueFb += 1;
      if (play.kind === "HR") leagueHr += 1;

      // Team batting (for form/OPS)
      const battingBucket = play.battingTeam === "home" ? homeBatting : awayBatting;
      addBatterEvent(battingBucket, play.kind);

      // Team batting split vs the defending pitcher's throwing hand
      const pitcherHand = rosters.get(play.pitcherId)?.throws;
      if (pitcherHand === "L" || pitcherHand === "R") {
        const splits = teamHandSplits.get(play.battingTeam === "home" ? game.homeTeamCode : game.awayTeamCode)
          ?? { vsL: emptyBatterBucket(), vsR: emptyBatterBucket() };
        addBatterEvent(pitcherHand === "L" ? splits.vsL : splits.vsR, play.kind);
        teamHandSplits.set(play.battingTeam === "home" ? game.homeTeamCode : game.awayTeamCode, splits);
      }
    }

    appendBullpenLog(bullpenLog, game.homeTeamCode, game.date, homeBullGame);
    appendBullpenLog(bullpenLog, game.awayTeamCode, game.date, awayBullGame);
    appendGameLog(teamGameLog, game.homeTeamCode, game.date, homeBatting);
    appendGameLog(teamGameLog, game.awayTeamCode, game.date, awayBatting);

    const homeWon = outcomes.get(`${game.date}|${game.homeTeamCode}|${game.awayTeamCode}`);
    updateRecord(teamRecord, game, homeWon);
  }

  return results;
}

function appendBullpenLog(log, teamCode, date, bucket) {
  if (bucket.outs === 0) return;
  const arr = log.get(teamCode) ?? [];
  arr.push({ date, ...bucket });
  log.set(teamCode, arr);
}

function rollingBullpen(log, beforeDate) {
  if (!log?.length) return null;
  const cutoff = addDaysToYyyymmdd(beforeDate, -BULLPEN_WINDOW_DAYS);
  const windowed = log.filter(e => e.date >= cutoff && e.date < beforeDate);
  if (!windowed.length) return null;
  return windowed.reduce((acc, e) => ({
    outs: acc.outs + e.outs, k: acc.k + e.k, bb: acc.bb + e.bb, hbp: acc.hbp + e.hbp,
    h1: acc.h1 + e.h1, h2: acc.h2 + e.h2, h3: acc.h3 + e.h3, hr: acc.hr + e.hr, fb: acc.fb + e.fb,
  }), emptyPitcherBucket());
}

function appendGameLog(log, teamCode, date, bucket) {
  if (bucket.pa === 0) return;
  const arr = log.get(teamCode) ?? [];
  arr.push({ date, ...bucket });
  log.set(teamCode, arr);
}

function rollingForm(log, windowSize) {
  if (!log?.length) return null;
  const windowed = log.slice(-windowSize);
  const summed = windowed.reduce((acc, g) => ({
    pa: acc.pa + g.pa, ab: acc.ab + g.ab, h1: acc.h1 + g.h1, h2: acc.h2 + g.h2,
    h3: acc.h3 + g.h3, hr: acc.hr + g.hr, bb: acc.bb + g.bb, hbp: acc.hbp + g.hbp,
  }), emptyBatterBucket());
  return opsFromBucket(summed);
}

function handSplitBucket(splits, hand) {
  if (!splits || (hand !== "L" && hand !== "R")) return null;
  return hand === "L" ? splits.vsL : splits.vsR;
}

function updateRecord(teamRecord, game, homeWon) {
  const homeRec = teamRecord.get(game.homeTeamCode) ?? { wins: 0, losses: 0 };
  const awayRec = teamRecord.get(game.awayTeamCode) ?? { wins: 0, losses: 0 };
  if (homeWon === true) { homeRec.wins += 1; awayRec.losses += 1; }
  else if (homeWon === false) { homeRec.losses += 1; awayRec.wins += 1; }
  teamRecord.set(game.homeTeamCode, homeRec);
  teamRecord.set(game.awayTeamCode, awayRec);
}

function addDaysToYyyymmdd(yyyymmdd, days) {
  const y = parseInt(yyyymmdd.slice(0, 4), 10);
  const m = parseInt(yyyymmdd.slice(4, 6), 10) - 1;
  const d = parseInt(yyyymmdd.slice(6, 8), 10);
  const dt = new Date(Date.UTC(y, m, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}${mm}${dd}`;
}
