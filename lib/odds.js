import { americanToDecimal, decimalToImplied, removeVig } from "./edge.js";
const API_KEY = process.env.ODDS_API_KEY;
const BASE = "https://api.the-odds-api.com/v4";
export async function fetchMLBOdds() {
  const res = await fetch(`${BASE}/sports/baseball_mlb/odds/?apiKey=${API_KEY}&regions=us&markets=h2h&oddsFormat=american&dateFormat=iso`);
  if (!res.ok) throw new Error("Failed to fetch odds");
  const games = await res.json();
  return games.map((game) => {
    const bookmaker = game.bookmakers?.[0];
    const market = bookmaker?.markets?.find((m) => m.key === "h2h");
    const outcomes = market?.outcomes || [];
    const home = outcomes.find((o) => o.name === game.home_team);
    const away = outcomes.find((o) => o.name === game.away_team);
    if (!home || !away) return null;
    const homeDecimal = americanToDecimal(home.price);
    const awayDecimal = americanToDecimal(away.price);
    const homeImplied = decimalToImplied(homeDecimal);
    const awayImplied = decimalToImplied(awayDecimal);
    const { fairHome, fairAway } = removeVig(homeImplied, awayImplied);
    return { id: game.id, homeTeam: game.home_team, awayTeam: game.away_team, commenceTime: game.commence_time, homeOdds: home.price, awayOdds: away.price, homeImplied: fairHome, awayImplied: fairAway, homeDecimal, awayDecimal };
  }).filter(Boolean);
}
