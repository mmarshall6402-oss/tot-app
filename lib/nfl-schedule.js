// NFL game-schedule fetching — the near-term multi-team schedule powering
// app/api/schedule/route.js (odds + ESPN scoreboard backfill), extracted out
// of that route so it can be shared, plus a single team's full-season
// schedule (app/api/nfl/team-schedule/route.js) built from ESPN's per-team
// schedule endpoint.
import { fetchNFLOdds } from "./nfl-odds.js";
import { nflTeamFullName } from "./nfl-team-names.js";
import { getNFLTeams, matchNFLTeam } from "./team-list.js";

const ESPN_NFL_SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";

export function ctDateStr(d) {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(d);
  return `${p.find(x => x.type === "year").value}-${p.find(x => x.type === "month").value}-${p.find(x => x.type === "day").value}`;
}

const lastWord = (s) => (s || "").toLowerCase().trim().split(" ").pop();

// ESPN's scoreboard `dates` range param is undocumented and, per lib/nfl-stats.js's
// existing single-date fetcher, unreliable beyond a single week — so this walks the
// window in 7-day chunks rather than trusting one big range request.
export async function fetchESPNNFLGames(start, end) {
  const chunkStarts = [];
  const cursor = new Date(`${start}T00:00:00Z`);
  const endD = new Date(`${end}T00:00:00Z`);
  while (cursor <= endD) {
    chunkStarts.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 7);
  }

  const espnFmt = (d) => d.toISOString().slice(0, 10).replace(/-/g, "");

  const chunks = await Promise.all(chunkStarts.map(async (chunkStart) => {
    const chunkEnd = new Date(chunkStart);
    chunkEnd.setDate(chunkEnd.getDate() + 6);
    try {
      const res = await fetch(`${ESPN_NFL_SCOREBOARD}?dates=${espnFmt(chunkStart)}-${espnFmt(chunkEnd)}`);
      if (!res.ok) return [];
      const json = await res.json();
      return json?.events || [];
    } catch {
      return [];
    }
  }));

  const seen = new Set();
  const games = [];
  for (const ev of chunks.flat()) {
    if (seen.has(ev.id)) continue;
    seen.add(ev.id);
    const comp = ev?.competitions?.[0];
    const home = comp?.competitors?.find(c => c?.homeAway === "home");
    const away = comp?.competitors?.find(c => c?.homeAway === "away");
    const homeTeam = home?.team?.displayName || null;
    const awayTeam = away?.team?.displayName || null;
    if (!homeTeam || !awayTeam || !ev.date) continue;
    const completed = !!comp?.status?.type?.completed;
    const inProgress = comp?.status?.type?.state === "in";
    games.push({
      id: `espn_${ev.id}`,
      date: ctDateStr(new Date(ev.date)),
      commenceTime: ev.date,
      homeTeam,
      awayTeam,
      homeOdds: null,
      awayOdds: null,
      spread: null,
      total: null,
      status: completed ? "Final" : inProgress ? "In Progress" : "Scheduled",
      homeScore: completed || inProgress ? Number(home?.score ?? 0) : null,
      awayScore: completed || inProgress ? Number(away?.score ?? 0) : null,
      venue: comp?.venue?.fullName || null,
    });
  }
  return games;
}

// The Odds API only returns games it has posted lines for — typically the next
// ~1-2 weeks — so games further out are backfilled (no odds) from ESPN's
// scoreboard, keyed off matchup + date since the two APIs use different ids.
export async function fetchNFLSchedule(start, end) {
  const [odds, espnGames] = await Promise.all([
    fetchNFLOdds(),
    fetchESPNNFLGames(start, end),
  ]);
  const startMs = new Date(`${start}T00:00:00Z`).getTime();
  const endMs = new Date(`${end}T23:59:59Z`).getTime();

  const withOdds = odds
    .filter(g => {
      const t = new Date(g.commenceTime).getTime();
      return t >= startMs && t <= endMs;
    })
    .map(g => ({
      id: g.id,
      date: ctDateStr(new Date(g.commenceTime)),
      commenceTime: g.commenceTime,
      homeTeam: g.homeTeam,
      awayTeam: g.awayTeam,
      homeOdds: g.homeOdds,
      awayOdds: g.awayOdds,
      spread: g.spread,
      total: g.total,
      status: "Scheduled",
      homeScore: null,
      awayScore: null,
      venue: null,
    }));

  const oddsKeys = new Set(withOdds.map(g => `${g.date}|${lastWord(g.homeTeam)}|${lastWord(g.awayTeam)}`));
  const backfill = espnGames.filter(g => !oddsKeys.has(`${g.date}|${lastWord(g.homeTeam)}|${lastWord(g.awayTeam)}`));

  return [...withOdds, ...backfill].sort((a, b) => new Date(a.commenceTime) - new Date(b.commenceTime));
}

const ESPN_NFL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// NFL game weeks turn over Tuesday (after Monday Night Football), so weeks
// are bucketed from the Tuesday on/before the season's first game rather
// than a plain calendar week — matches the "fantasy week" convention already
// used in lib/auth.js's weekStartDate. Fallback only: used when ESPN doesn't
// hand back an explicit week number for an event (see below).
function tuesdayOnOrBefore(d) {
  const day = d.getUTCDay(); // 0 Sun .. 6 Sat
  const back = (day - 2 + 7) % 7;
  const t = new Date(d);
  t.setUTCDate(t.getUTCDate() - back);
  t.setUTCHours(0, 0, 0, 0);
  return t;
}

// Cheap in-process cache — same reasoning as lib/team-list.js's team cache.
// Schedules barely change once published (score/status updates aside), so a
// multi-hour TTL is safe.
const TEAM_SCHEDULE_TTL = 1000 * 60 * 60 * 6;
const _teamScheduleCache = new Map(); // `${espnTeamId}|${season}` -> { events, ts }

// ESPN's own per-team schedule sub-resource — already relied on by
// app/api/team/route.js's buildNFLTeam for that team's roster/schedule page,
// so this reuses a shape already proven against live traffic rather than a
// second, unverified fetch pattern. seasontype=2 restricts to the regular
// season (excludes preseason/postseason weeks, which would otherwise shift
// the week numbering and bye-week detection below).
async function fetchTeamEvents(espnTeamId, season) {
  const cacheKey = `${espnTeamId}|${season}`;
  const hit = _teamScheduleCache.get(cacheKey);
  if (hit && Date.now() - hit.ts < TEAM_SCHEDULE_TTL) return hit.events;

  const res = await fetch(`${ESPN_NFL}/teams/${espnTeamId}/schedule?season=${season}&seasontype=2`);
  if (!res.ok) throw new Error(`ESPN team schedule ${res.status}`);
  const json = await res.json();

  const events = [];
  for (const ev of (json?.events || [])) {
    const comp = ev?.competitions?.[0];
    const home = comp?.competitors?.find(c => c?.homeAway === "home");
    const away = comp?.competitors?.find(c => c?.homeAway === "away");
    const homeTeam = home?.team?.displayName || null;
    const awayTeam = away?.team?.displayName || null;
    if (!homeTeam || !awayTeam || !ev.date) continue;
    const completed = !!comp?.status?.type?.completed;
    const inProgress = comp?.status?.type?.state === "in";
    events.push({
      date: ctDateStr(new Date(ev.date)),
      commenceTime: ev.date,
      homeTeam,
      awayTeam,
      // week.number isn't confirmed present on every ESPN payload shape, so
      // it's read opportunistically here and only trusted below if every
      // event has one — otherwise all events fall back to date-bucketing
      // together, rather than mixing two numbering schemes.
      weekNumber: Number.isFinite(ev?.week?.number) ? ev.week.number : null,
      status: completed ? "Final" : inProgress ? "In Progress" : "Scheduled",
      homeScore: completed || inProgress ? Number(home?.score ?? 0) : null,
      awayScore: completed || inProgress ? Number(away?.score ?? 0) : null,
      // Same competition-object shape fetchESPNNFLGames already reads venue
      // from (this hits a different ESPN endpoint but the same underlying
      // competition payload), so venue/broadcast are pulled the same way.
      venue: comp?.venue?.fullName || null,
      network: comp?.broadcasts?.[0]?.names?.[0] || null,
    });
  }
  events.sort((a, b) => new Date(a.commenceTime) - new Date(b.commenceTime));
  _teamScheduleCache.set(cacheKey, { events, ts: Date.now() });
  return events;
}

// Returns one team's full-season schedule with a synthesized BYE entry for
// the one week it has no game. `team` may be any abbreviation or full name
// lib/nfl-team-names.js recognizes, or an ESPN displayName. Each non-bye game
// carries matchup detail beyond the bare opponent/score: venue, broadcast
// network, this team's running W-L record through that week, and — for
// games still ahead of the current odds window — the market's line
// (spread/total/moneyline), merged in the same date+team-lastword way
// fetchNFLSchedule already merges ESPN backfill against TOA odds.
export async function computeTeamSeasonSchedule(team, season) {
  const teams = await getNFLTeams();
  const espnTeam = matchNFLTeam(teams, nflTeamFullName(team) || team);
  if (!espnTeam) return { team, season, games: [], error: `Unknown team "${team}"` };

  const events = await fetchTeamEvents(espnTeam.id, season);
  if (!events.length) return { team: espnTeam.displayName, season, games: [] };

  const weekOf = events.every(e => e.weekNumber != null)
    ? (e) => e.weekNumber
    : (() => {
        const anchor = tuesdayOnOrBefore(new Date(events[0].commenceTime));
        return (e) => Math.max(1, Math.floor((new Date(e.commenceTime).getTime() - anchor.getTime()) / WEEK_MS) + 1);
      })();

  const byWeek = new Map(events.map(e => [weekOf(e), e]));
  const maxWeek = Math.max(...byWeek.keys());

  // Odds are only posted for the near-term slate (see fetchNFLSchedule above),
  // so a lookup miss here just leaves that week's line blank — not an error.
  let odds = [];
  try { odds = await fetchNFLOdds(); } catch { odds = []; }
  const oddsByKey = new Map(
    odds.map(o => [`${ctDateStr(new Date(o.commenceTime))}|${lastWord(o.homeTeam)}|${lastWord(o.awayTeam)}`, o])
  );

  const games = [];
  let wins = 0, losses = 0, ties = 0;
  for (let wk = 1; wk <= maxWeek; wk++) {
    const g = byWeek.get(wk);
    if (!g) { games.push({ week: wk, bye: true }); continue; }
    const isHome = g.homeTeam === espnTeam.displayName;
    const teamScore = isHome ? g.homeScore : g.awayScore;
    const oppScore = isHome ? g.awayScore : g.homeScore;

    let result = null;
    if (g.status === "Final") {
      result = teamScore > oppScore ? "W" : teamScore < oppScore ? "L" : "T";
      if (result === "W") wins++; else if (result === "L") losses++; else ties++;
    }

    const line = g.status !== "Final"
      ? oddsByKey.get(`${g.date}|${lastWord(g.homeTeam)}|${lastWord(g.awayTeam)}`)
      : null;

    games.push({
      week: wk,
      bye: false,
      date: g.date,
      commenceTime: g.commenceTime,
      opponent: isHome ? g.awayTeam : g.homeTeam,
      isHome,
      status: g.status,
      homeScore: g.homeScore,
      awayScore: g.awayScore,
      result,
      recordAfter: result ? `${wins}-${losses}${ties ? `-${ties}` : ""}` : null,
      venue: g.venue,
      network: g.network,
      spread: line?.spread ?? null,
      total: line?.total ?? null,
      homeOdds: line?.homeOdds ?? null,
      awayOdds: line?.awayOdds ?? null,
    });
  }

  return { team: espnTeam.displayName, season, games };
}
