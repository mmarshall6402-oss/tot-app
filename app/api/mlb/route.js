import { fetchPitcherHardHit, fetchBatterStatcast } from "../../../lib/savant.js";

const MLB            = "https://statsapi.mlb.com/api/v1";
const CURRENT_SEASON = new Date().getFullYear();

function getPastDate(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split("T")[0];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseIP(raw) {
  if (!raw) return 0;
  const [w, p = "0"] = String(raw).split(".");
  return parseInt(w, 10) + parseInt(p, 10) / 3;
}

// K-BB% and xFIP from raw pitcher stat object (MLB Stats API fields)
function advancedPitcherMetrics(stat) {
  if (!stat) return {};
  const k   = parseInt(stat.strikeOuts   || 0);
  const bb  = parseInt(stat.baseOnBalls  || 0);
  const hbp = parseInt(stat.hitBatsmen   || 0);
  const hr  = parseInt(stat.homeRuns     || 0);
  const fo  = parseInt(stat.airOuts      || 0);  // fly outs (excludes HR)
  const bf  = parseInt(stat.battersFaced || 0);
  const ip  = parseIP(stat.inningsPitched);

  // K-BB%: (K - BB) / PA — most stable early-season indicator
  const kBBPct = bf > 0 ? parseFloat(((k - bb) / bf * 100).toFixed(1)) : null;

  // xFIP: normalises HR rate to league avg (10.5% of FB become HR)
  // Total FB = fly outs + home runs
  const fb  = fo + hr;
  const xFip = ip > 0
    ? parseFloat(((13 * fb * 0.105 + 3 * (bb + hbp) - 2 * k) / ip + 3.10).toFixed(2))
    : null;

  return { kBBPct, xFip, fb, ip };
}

// ─── Fetchers ─────────────────────────────────────────────────────────────────

async function fetchPitcherStats(pitcherId) {
  if (!pitcherId) return null;
  try {
    const r = await fetch(`${MLB}/people/${pitcherId}/stats?stats=season&group=pitching&season=${CURRENT_SEASON}`);
    const d = await r.json();
    const stat = d?.stats?.[0]?.splits?.[0]?.stat;
    return stat && (stat.era || stat.whip || stat.wins !== undefined) ? stat : null;
  } catch { return null; }
}

async function fetchPitcherHand(pitcherId) {
  if (!pitcherId) return null;
  try {
    const r = await fetch(`${MLB}/people/${pitcherId}`);
    const d = await r.json();
    return d?.people?.[0]?.pitchHand?.code ?? null;  // "R" or "L"
  } catch { return null; }
}

async function fetchTeamHitting(teamId, startDate, endDate) {
  if (!teamId) return null;
  try {
    const r = await fetch(`${MLB}/teams/${teamId}/stats?stats=byDateRange&group=hitting&season=${CURRENT_SEASON}&startDate=${startDate}&endDate=${endDate}`);
    const d = await r.json();
    const stat = d?.stats?.[0]?.splits?.[0]?.stat;
    return stat?.gamesPlayed > 0 ? stat : null;
  } catch { return null; }
}

// Rolling N-day team pitching (mostly bullpen — starters account for ~55% of IP)
async function fetchRollingPitching(teamId, startDate, endDate) {
  if (!teamId) return null;
  try {
    const r = await fetch(`${MLB}/teams/${teamId}/stats?stats=byDateRange&group=pitching&season=${CURRENT_SEASON}&startDate=${startDate}&endDate=${endDate}`);
    const d = await r.json();
    const stat = d?.stats?.[0]?.splits?.[0]?.stat;
    return stat?.inningsPitched ? {
      era:  stat.era  ?? null,
      whip: stat.whip ?? null,
      k9:   stat.strikeoutsPer9Inn ?? null,
      ip:   parseIP(stat.inningsPitched),
    } : null;
  } catch { return null; }
}

// Season bullpen aggregate (fallback when rolling not enough data)
async function fetchSeasonPitching(teamId) {
  if (!teamId) return null;
  try {
    const r = await fetch(`${MLB}/teams/${teamId}/stats?stats=season&group=pitching&season=${CURRENT_SEASON}`);
    const d = await r.json();
    const stat = d?.stats?.[0]?.splits?.[0]?.stat;
    return stat?.era ? { era: stat.era, whip: stat.whip ?? null, k9: stat.strikeoutsPer9Inn ?? null } : null;
  } catch { return null; }
}

// Team batting OPS vs LHP and vs RHP — lineup quality vs pitcher handedness
async function fetchTeamHandednessSplits(teamId) {
  if (!teamId) return null;
  try {
    const r = await fetch(`${MLB}/teams/${teamId}/stats?stats=statSplits&group=hitting&season=${CURRENT_SEASON}&sitCodes=vl,vr`);
    const d = await r.json();
    const splits = d?.stats?.[0]?.splits || [];
    const result = {};
    for (const s of splits) {
      const code = s.split?.code; // "vl" or "vr"
      if (code === "vl") result.vsLeft  = parseFloat(s.stat?.ops) || null;
      if (code === "vr") result.vsRight = parseFloat(s.stat?.ops) || null;
    }
    return Object.keys(result).length ? result : null;
  } catch { return null; }
}

async function fetchStandings() {
  try {
    const r = await fetch(`${MLB}/standings?leagueId=103,104&season=${CURRENT_SEASON}&standingsTypes=regularSeason`);
    const d = await r.json();
    const teams = {};
    for (const record of d?.records || []) {
      for (const tr of record.teamRecords || []) {
        teams[tr.team.id] = {
          wins: tr.wins, losses: tr.losses,
          runDifferential: tr.runDifferential || 0,
          winningPercentage: parseFloat(tr.winningPercentage) || 0.500,
          streak: tr.streak?.streakCode || "",
        };
      }
    }
    return teams;
  } catch { return {}; }
}

// Recent starts game log — last N starts weighted more than full-season ERA
async function fetchPitcherRecentStarts(pitcherId, numStarts = 5) {
  if (!pitcherId) return null;
  try {
    const r = await fetch(`${MLB}/people/${pitcherId}/stats?stats=gameLog&group=pitching&season=${CURRENT_SEASON}`);
    const d = await r.json();
    const splits = d?.stats?.[0]?.splits || [];
    // Only include starts (>=1 IP typically means a start, not a relief app)
    const starts = splits.filter(s => parseIP(s.stat?.inningsPitched) >= 2.0).slice(-numStarts);
    if (starts.length < 2) return null;
    const tot = starts.reduce((acc, s) => ({
      ip: acc.ip + parseIP(s.stat.inningsPitched),
      er: acc.er + parseInt(s.stat.earnedRuns  || 0),
      h:  acc.h  + parseInt(s.stat.hits        || 0),
      bb: acc.bb + parseInt(s.stat.baseOnBalls || 0),
      k:  acc.k  + parseInt(s.stat.strikeOuts  || 0),
      bf: acc.bf + parseInt(s.stat.battersFaced || 0),
    }), { ip: 0, er: 0, h: 0, bb: 0, k: 0, bf: 0 });
    if (tot.ip < 6) return null;
    return {
      era:    parseFloat(((tot.er / tot.ip) * 9).toFixed(2)),
      whip:   parseFloat(((tot.h + tot.bb) / tot.ip).toFixed(2)),
      kBBPct: tot.bf > 0 ? parseFloat(((tot.k - tot.bb) / tot.bf * 100).toFixed(1)) : null,
      ip:     parseFloat(tot.ip.toFixed(1)),
      numStarts: starts.length,
    };
  } catch { return null; }
}

// Module-level cache: keyed by date, expires after 4 minutes for live dates.
// Past dates are cached indefinitely (scores don't change).
const _mlbCache = new Map();
const LIVE_TTL = 4 * 60 * 1000;

// MLB "game day" is defined in US time, not UTC — use the same America/Chicago
// convention as the rest of the pipeline (app/api/picks/route.js, lib/odds.js)
// so this route's "today" doesn't roll over hours before the actual CT day ends.
function ctDateStr(d = new Date()) {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(d);
  return `${p.find(x => x.type === "year").value}-${p.find(x => x.type === "month").value}-${p.find(x => x.type === "day").value}`;
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const date    = searchParams.get("date") || ctDateStr();
    const today   = ctDateStr();

    const cached  = _mlbCache.get(date);
    const isPast  = date < today;
    if (cached && (isPast || Date.now() - cached.ts < LIVE_TTL)) {
      return Response.json(cached.data);
    }

    const past3   = getPastDate(3);
    const past7   = getPastDate(7);
    const past10  = getPastDate(10);
    const past14  = getPastDate(14);

    // Fetch Savant data once for all games (both pitcher and batter leaderboards)
    const [savantMap, savantBatterMap] = await Promise.all([
      fetchPitcherHardHit(CURRENT_SEASON),
      fetchBatterStatcast(CURRENT_SEASON),
    ]);

    const [schedRes, standings] = await Promise.all([
      fetch(`${MLB}/schedule?sportId=1&hydrate=probablePitcher,linescore,lineups,teams&date=${date}`),
      fetchStandings(),
    ]);

    const schedData = await schedRes.json();
    const games     = schedData?.dates?.[0]?.games || [];

    const enriched = await Promise.all(games.map(async (game) => {
      const homeId      = game.teams?.home?.team?.id;
      const awayId      = game.teams?.away?.team?.id;
      const homePitcher = game.teams?.home?.probablePitcher;
      const awayPitcher = game.teams?.away?.probablePitcher;
      const linescore   = game.linescore;

      const [
        homePStats, awayPStats,
        homePHand,  awayPHand,
        homeForm,   awayForm,
        homeForm7d, awayForm7d,
        homeRolling3, awayRolling3,
        homeRolling7, awayRolling7,
        homeRolling14, awayRolling14,
        homeSeason,  awaySeason,
        homeSplits,  awaySplits,
        homeRecentStarts, awayRecentStarts,
      ] = await Promise.all([
        fetchPitcherStats(homePitcher?.id),
        fetchPitcherStats(awayPitcher?.id),
        fetchPitcherHand(homePitcher?.id),
        fetchPitcherHand(awayPitcher?.id),
        fetchTeamHitting(homeId, past10, date),
        fetchTeamHitting(awayId, past10, date),
        fetchTeamHitting(homeId, past7,  date),
        fetchTeamHitting(awayId, past7,  date),
        fetchRollingPitching(homeId, past3,  date),
        fetchRollingPitching(awayId, past3,  date),
        fetchRollingPitching(homeId, past7,  date),
        fetchRollingPitching(awayId, past7,  date),
        fetchRollingPitching(homeId, past14, date),
        fetchRollingPitching(awayId, past14, date),
        fetchSeasonPitching(homeId),
        fetchSeasonPitching(awayId),
        fetchTeamHandednessSplits(homeId),
        fetchTeamHandednessSplits(awayId),
        fetchPitcherRecentStarts(homePitcher?.id),
        fetchPitcherRecentStarts(awayPitcher?.id),
      ]);

      const buildPitcher = (pitcher, stats, recentStarts) => {
        if (!pitcher) return null;
        const adv = advancedPitcherMetrics(stats);
        const savant = savantMap.get(pitcher.id) || null;
        return {
          name:           pitcher.fullName,
          id:             pitcher.id,
          hand:           null,
          era:            stats?.era          ?? null,
          whip:           stats?.whip         ?? null,
          wins:           stats?.wins         ?? 0,
          losses:         stats?.losses       ?? 0,
          strikeoutsPer9: stats?.strikeoutsPer9Inn ?? null,
          inningsPitched: stats?.inningsPitched    ?? null,
          kBBPct:         adv.kBBPct,
          xFip:           adv.xFip,
          hardHitPct:     savant?.hardHitPct  ?? null,
          barrelPct:      savant?.barrelPct   ?? null,
          avgExitVelo:    savant?.avgExitVelo ?? null,
          // Recent starts (last 5): more predictive than season avg alone
          recentStarts:   recentStarts ?? null,
        };
      };

      const homePitcherObj = buildPitcher(homePitcher, homePStats, homeRecentStarts);
      const awayPitcherObj = buildPitcher(awayPitcher, awayPStats, awayRecentStarts);
      if (homePitcherObj) homePitcherObj.hand = homePHand;
      if (awayPitcherObj) awayPitcherObj.hand = awayPHand;

      // Lineup handedness matchup:
      // home lineup OPS against away pitcher handedness (and vice versa)
      const homeLineupAdj = homeSplits
        ? (awayPHand === "L" ? homeSplits.vsLeft : homeSplits.vsRight) ?? null
        : null;
      const awayLineupAdj = awaySplits
        ? (homePHand === "L" ? awaySplits.vsLeft : awaySplits.vsRight) ?? null
        : null;

      // Prefer 7-day bullpen (most current) → 14-day → season aggregate.
      // Adds fatigue signal: if 3-day ERA is 1.5+ worse than 14-day, bullpen is overworked.
      const buildBullpen = (r3, r7, r14, season) => {
        const src = (r7?.ip ?? 0) >= 4 ? r7 : (r14?.ip ?? 0) >= 8 ? r14 : season;
        if (!src) return null;
        const era3  = r3?.era  != null ? parseFloat(r3.era)  : null;
        const era14 = r14?.era != null ? parseFloat(r14.era) : null;
        const eraInflation = (era3 !== null && era14 !== null)
          ? parseFloat((era3 - era14).toFixed(2)) : null;
        return {
          era: src.era ?? null, whip: src.whip ?? null, k9: src.k9 ?? null,
          isRolling: src === r7 || src === r14,
          window:    src === r7 ? 7 : src === r14 ? 14 : null,
          era3d:        era3,
          eraInflation, // positive = ERA recently worse than 14-day baseline
          fatigued:     eraInflation !== null && eraInflation > 1.5,
        };
      };

      // Lineup quality from Baseball Savant when lineups are confirmed (~90 min pre-game).
      // Returns avg wOBA/ISO/barrelPct across the batting order — quality signal, not streak.
      const homeLineupIds = (game.lineups?.homeBatters || []).map(p => p.id).filter(Boolean);
      const awayLineupIds = (game.lineups?.awayBatters || []).map(p => p.id).filter(Boolean);
      const buildLineupSavant = (batterIds) => {
        if (!batterIds.length) return null;
        const stats = batterIds.slice(0, 9).map(id => savantBatterMap.get(id)).filter(Boolean);
        if (!stats.length) return null;
        const avg = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
        return {
          avgWoba:      avg(stats.map(s => s.woba).filter(v => v != null)),
          avgXwoba:     avg(stats.map(s => s.xwoba).filter(v => v != null)),
          avgIso:       avg(stats.map(s => s.iso).filter(v => v != null)),
          avgBarrelPct: avg(stats.map(s => s.barrelPct).filter(v => v != null)),
          batterCount:  batterIds.length,
        };
      };

      return {
        gameId:       game.gamePk,
        homeTeam:     game.teams?.home?.team?.name,
        awayTeam:     game.teams?.away?.team?.name,
        homeId, awayId,
        commenceTime: game.gameDate,
        status:       game.status?.abstractGameState,
        homeScore:    linescore?.teams?.home?.runs ?? null,
        awayScore:    linescore?.teams?.away?.runs ?? null,
        inning:       linescore?.currentInning     ?? null,
        inningHalf:   linescore?.inningHalf        ?? null,
        homePitcher:  homePitcherObj,
        awayPitcher:  awayPitcherObj,
        homeForm, awayForm,
        homeBullpen:  buildBullpen(homeRolling3, homeRolling7, homeRolling14, homeSeason),
        awayBullpen:  buildBullpen(awayRolling3, awayRolling7, awayRolling14, awaySeason),
        homeStandings: standings[homeId] ?? null,
        awayStandings: standings[awayId] ?? null,
        // Lineup vs handedness (null until lineups post ~90 min before game)
        homeLineupOpsVsPitcher: homeLineupAdj,
        awayLineupOpsVsPitcher: awayLineupAdj,
        // 7-day hitting form (more sensitive to recent hot/cold streaks than 10-day)
        homeForm7d, awayForm7d,
        // Lineup quality from Savant (wOBA, ISO, barrel% — when lineup posted)
        homeLineupSavant: buildLineupSavant(homeLineupIds),
        awayLineupSavant: buildLineupSavant(awayLineupIds),
      };
    }));

    const payload = { games: enriched, date };
    _mlbCache.set(date, { data: payload, ts: Date.now() });
    return Response.json(payload);
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
