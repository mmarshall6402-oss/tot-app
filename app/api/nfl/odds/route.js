import { requireAuth } from "../../../../lib/auth.js";

const TOA_KEY = process.env.THE_ODDS_API_KEY;
const TOA_BASE = "https://api.the-odds-api.com/v4";

function fmtAmerican(decimal) {
  if (!decimal) return null;
  if (decimal >= 2) return Math.round((decimal - 1) * 100);
  return -Math.round(100 / (decimal - 1));
}

function removeVig(h, a) {
  const total = h + a;
  return { fairHome: h / total, fairAway: a / total };
}

export async function GET(request) {
  const { error: authError } = await requireAuth(request);
  if (authError) return authError;

  if (!TOA_KEY) return Response.json({ games: [], message: "No odds API key configured" });

  try {
    // Fetch spreads, h2h, and totals
    const [h2hRes, spreadRes, totalsRes] = await Promise.all([
      fetch(`${TOA_BASE}/sports/americanfootball_nfl/odds?apiKey=${TOA_KEY}&regions=us&markets=h2h&oddsFormat=decimal&dateFormat=iso`),
      fetch(`${TOA_BASE}/sports/americanfootball_nfl/odds?apiKey=${TOA_KEY}&regions=us&markets=spreads&oddsFormat=decimal&dateFormat=iso`),
      fetch(`${TOA_BASE}/sports/americanfootball_nfl/odds?apiKey=${TOA_KEY}&regions=us&markets=totals&oddsFormat=decimal&dateFormat=iso`),
    ]);

    if (!h2hRes.ok) {
      const txt = await h2hRes.text();
      return Response.json({ games: [], message: `Odds API error: ${h2hRes.status}` });
    }

    const [h2hData, spreadData, totalsData] = await Promise.all([
      h2hRes.json(),
      spreadRes.ok ? spreadRes.json() : [],
      totalsRes.ok ? totalsRes.json() : [],
    ]);

    const BOOKS = ["pinnacle", "draftkings", "fanduel", "betmgm", "caesars", "bet365", "betonlineag", "bovada"];

    function bestLine(bookmakers, market, outcomeKey) {
      for (const book of BOOKS) {
        const bm = bookmakers?.find(b => b.key === book);
        const mkt = bm?.markets?.find(m => m.key === market);
        if (!mkt) continue;
        const outcome = mkt.outcomes?.find(o => o.name === outcomeKey || o.description === outcomeKey);
        if (outcome) return { price: outcome.price, point: outcome.point ?? null };
      }
      // fallback: first available
      for (const bm of (bookmakers || [])) {
        const mkt = bm?.markets?.find(m => m.key === market);
        if (!mkt) continue;
        const outcome = mkt.outcomes?.find(o => o.name === outcomeKey || o.description === outcomeKey);
        if (outcome) return { price: outcome.price, point: outcome.point ?? null };
      }
      return null;
    }

    const spreadMap = {};
    const totalsMap = {};
    for (const g of (Array.isArray(spreadData) ? spreadData : [])) spreadMap[g.id] = g;
    for (const g of (Array.isArray(totalsData) ? totalsData : [])) totalsMap[g.id] = g;

    const games = (Array.isArray(h2hData) ? h2hData : []).map(g => {
      const homeTeam = g.home_team;
      const awayTeam = g.away_team;

      const homeH2H = bestLine(g.bookmakers, "h2h", homeTeam);
      const awayH2H = bestLine(g.bookmakers, "h2h", awayTeam);

      const homeSpread = bestLine(spreadMap[g.id]?.bookmakers, "spreads", homeTeam);
      const awaySpread = bestLine(spreadMap[g.id]?.bookmakers, "spreads", awayTeam);

      const overLine = bestLine(totalsMap[g.id]?.bookmakers, "totals", "Over");
      const underLine = bestLine(totalsMap[g.id]?.bookmakers, "totals", "Under");

      const homeImpl = homeH2H ? 1 / homeH2H.price : null;
      const awayImpl = awayH2H ? 1 / awayH2H.price : null;
      const { fairHome, fairAway } = (homeImpl && awayImpl) ? removeVig(homeImpl, awayImpl) : { fairHome: null, fairAway: null };

      return {
        id: g.id,
        homeTeam,
        awayTeam,
        commenceTime: g.commence_time,
        homeOdds: homeH2H ? fmtAmerican(homeH2H.price) : null,
        awayOdds: awayH2H ? fmtAmerican(awayH2H.price) : null,
        homeImplied: fairHome,
        awayImplied: fairAway,
        spread: homeSpread?.point ?? null,
        homeSpreadOdds: homeSpread ? fmtAmerican(homeSpread.price) : null,
        awaySpreadOdds: awaySpread ? fmtAmerican(awaySpread.price) : null,
        total: overLine?.point ?? null,
        overOdds: overLine ? fmtAmerican(overLine.price) : null,
        underOdds: underLine ? fmtAmerican(underLine.price) : null,
      };
    });

    return Response.json({ games, count: games.length });
  } catch (e) {
    console.error("NFL odds error", e);
    return Response.json({ games: [], error: e.message }, { status: 500 });
  }
}
