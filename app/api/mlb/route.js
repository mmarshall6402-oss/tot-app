import { fetchPitcherHardHit } from "../../../lib/savant.js";

const MLB            = "https://statsapi.mlb.com/api/v1";
const CURRENT_SEASON = 2026;

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

// ─── GET handler ──────────────────────────────────────────────────────────────

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const date    = searchParams.get("date") || new Date().toISOString().split("T")[0];
    const past10  = getPastDate(10);
    const past14  = getPastDate(14);

    // Fetch Savant hard-hit data once for all games
    const savantMap = await fetchPitcherHardHit(CURRENT_SEASON);

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
        homeRolling, awayRolling,
        homeSeason,  awaySeason,
        homeSplits,  awaySplits,
      ] = await Promise.all([
        fetchPitcherStats(homePitcher?.id),
        fetchPitcherStats(awayPitcher?.id),
        fetchPitcherHand(homePitcher?.id),
        fetchPitcherHand(awayPitcher?.id),
        fetchTeamHitting(homeId, past10, date),
        fetchTeamHitting(awayId, past10, date),
        fetchRollingPitching(homeId, past14, date),
        fetchRollingPitching(awayId, past14, date),
        fetchSeasonPitching(homeId),
        fetchSeasonPitching(awayId),
        fetchTeamHandednessSplits(homeId),
        fetchTeamHandednessSplits(awayId),
      ]);

      const buildPitcher = (pitcher, stats) => {
        if (!pitcher) return null;
        const adv = advancedPitcherMetrics(stats);
        const savant = savantMap.get(pitcher.id) || null;
        return {
          name:           pitcher.fullName,
          id:             pitcher.id,
          hand:           homePHand,   // filled below per pitcher
          era:            stats?.era          ?? null,
          whip:           stats?.whip         ?? null,
          wins:           stats?.wins         ?? 0,
          losses:         stats?.losses       ?? 0,
          strikeoutsPer9: stats?.strikeoutsPer9Inn ?? null,
          inningsPitched: stats?.inningsPitched    ?? null,
          // Advanced
          kBBPct:         adv.kBBPct,
          xFip:           adv.xFip,
          // Statcast
          hardHitPct:     savant?.hardHitPct  ?? null,
          barrelPct:      savant?.barrelPct   ?? null,
          avgExitVelo:    savant?.avgExitVelo ?? null,
        };
      };

      const homePitcherObj = buildPitcher(homePitcher, homePStats);
      const awayPitcherObj = buildPitcher(awayPitcher, awayPStats);
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

      // Prefer rolling 14d bullpen; fall back to season aggregate
      const buildBullpen = (rolling, season) => {
        const src = (rolling?.ip ?? 0) >= 5 ? rolling : season;
        if (!src) return null;
        return { era: src.era ?? null, whip: src.whip ?? null, k9: src.k9 ?? null, isRolling: src === rolling };
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
        homeBullpen:  buildBullpen(homeRolling, homeSeason),
        awayBullpen:  buildBullpen(awayRolling, awaySeason),
        homeStandings: standings[homeId] ?? null,
        awayStandings: standings[awayId] ?? null,
        // Lineup vs handedness (null until lineups post ~90 min before game)
        homeLineupOpsVsPitcher: homeLineupAdj,
        awayLineupOpsVsPitcher: awayLineupAdj,
      };
    }));

    return Response.json({ games: enriched, date });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
