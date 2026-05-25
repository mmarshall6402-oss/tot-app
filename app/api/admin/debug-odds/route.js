const TOA_KEY  = process.env.THE_ODDS_API_KEY;
const TOA_BASE = "https://api.the-odds-api.com/v4";
const SGO_KEY  = process.env.SPORTSGAMEODDS_API_KEY;
const SGO_BASE = "https://api.sportsgameodds.com/v2";

export async function GET(request) {

  const results = {};

  // Test The Odds API
  try {
    if (!TOA_KEY) throw new Error("THE_ODDS_API_KEY env var not set");
    const url = `${TOA_BASE}/sports/baseball_mlb/odds?apiKey=${TOA_KEY}&regions=us&markets=h2h&oddsFormat=american&dateFormat=iso`;
    const r = await fetch(url);
    const remaining = r.headers.get("x-requests-remaining");
    const used = r.headers.get("x-requests-used");
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      results.toa = { ok: false, status: r.status, error: body.slice(0, 200) };
    } else {
      const events = await r.json();
      results.toa = {
        ok: true,
        games: Array.isArray(events) ? events.length : "not array",
        requestsRemaining: remaining,
        requestsUsed: used,
        sample: Array.isArray(events) ? events.slice(0, 2).map(e => e.home_team + " vs " + e.away_team) : [],
      };
    }
  } catch (e) {
    results.toa = { ok: false, error: e.message };
  }

  // Test SportsGameOdds
  try {
    if (!SGO_KEY) throw new Error("SPORTSGAMEODDS_API_KEY env var not set");
    const params = new URLSearchParams({ leagueID: "MLB", oddID: "points-home-game-ml-home,points-away-game-ml-away", oddsAvailable: "true", limit: "50", apiKey: SGO_KEY });
    const r = await fetch(`${SGO_BASE}/events?${params}`);
    if (!r.ok) {
      results.sgo = { ok: false, status: r.status };
    } else {
      const json = await r.json();
      results.sgo = {
        ok: !json?.error,
        games: json?.data?.length ?? 0,
        error: json?.error || null,
        sample: (json?.data || []).slice(0, 2).map(e => (e.teams?.home?.names?.full || e.teams?.home?.teamID) + " vs " + (e.teams?.away?.names?.full || e.teams?.away?.teamID)),
      };
    }
  } catch (e) {
    results.sgo = { ok: false, error: e.message };
  }

  // Test ESPN (free, no key)
  try {
    const today = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(new Date()).reduce((a, p) => ({ ...a, [p.type]: p.value }), {});
    const d = `${today.year}${today.month}${today.day}`;
    const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard?dates=${d}`);
    if (!r.ok) {
      results.espn = { ok: false, status: r.status };
    } else {
      const json = await r.json();
      const events = json?.events || [];
      const withOdds = events.filter(e => {
        const comp = e.competitions?.[0];
        return (comp?.odds || []).some(o => o.homeTeamOdds?.moneyLine != null || o.homeTeamOdds?.current?.moneyLine != null);
      });
      results.espn = {
        ok: true,
        totalGames: events.length,
        gamesWithOdds: withOdds.length,
        sample: events.slice(0, 2).map(e => {
          const comp = e.competitions?.[0];
          const home = comp?.competitors?.find(c => c.homeAway === "home")?.team?.displayName;
          const away = comp?.competitors?.find(c => c.homeAway === "away")?.team?.displayName;
          return `${away} @ ${home}`;
        }),
      };
    }
  } catch (e) {
    results.espn = { ok: false, error: e.message };
  }

  return Response.json(results);
}
