import { requireAuth } from "../../../../lib/auth.js";
import Anthropic from "@anthropic-ai/sdk";

const MLB_API = "https://statsapi.mlb.com/api/v1";
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function getBoxscore(gamePk) {
  const [boxRes, lineRes] = await Promise.all([
    fetch(`${MLB_API}/game/${gamePk}/boxscore`),
    fetch(`${MLB_API}/game/${gamePk}/linescore`),
  ]);
  const [box, line] = await Promise.all([boxRes.json(), lineRes.json()]);
  return { box, line };
}

function parseBoxscore(box, line) {
  const home = box.teams?.home;
  const away = box.teams?.away;

  const homeName = home?.team?.name || "";
  const awayName = away?.team?.name || "";
  const homeRuns = line?.teams?.home?.runs ?? home?.teamStats?.batting?.runs ?? null;
  const awayRuns = line?.teams?.away?.runs ?? away?.teamStats?.batting?.runs ?? null;
  const homeHits = home?.teamStats?.batting?.hits ?? null;
  const awayHits = away?.teamStats?.batting?.hits ?? null;

  function getStarter(teamBox) {
    const pitchers = teamBox?.pitchers || [];
    if (!pitchers.length) return null;
    const id = pitchers[0];
    const p = teamBox?.players?.[`ID${id}`];
    if (!p) return null;
    const stats = p.stats?.pitching;
    return {
      name: p.person?.fullName || "Unknown",
      ip: stats?.inningsPitched ?? "?",
      er: stats?.earnedRuns ?? "?",
      k: stats?.strikeOuts ?? "?",
      bb: stats?.baseOnBalls ?? "?",
    };
  }

  function getNotables(teamBox) {
    const batters = teamBox?.batters || [];
    return batters
      .map(id => teamBox?.players?.[`ID${id}`])
      .filter(p => p && ((p.stats?.batting?.hits ?? 0) >= 2 || (p.stats?.batting?.rbi ?? 0) >= 1))
      .map(p => ({
        name: p.person?.fullName || "",
        h: p.stats?.batting?.hits ?? 0,
        rbi: p.stats?.batting?.rbi ?? 0,
        hr: p.stats?.batting?.homeRuns ?? 0,
      }))
      .slice(0, 3);
  }

  return {
    homeName, awayName, homeRuns, awayRuns, homeHits, awayHits,
    homeStarter: getStarter(home),
    awayStarter: getStarter(away),
    homeNotables: getNotables(home),
    awayNotables: getNotables(away),
  };
}

async function findGamePk(homeTeam, awayTeam, date) {
  const res = await fetch(`${MLB_API}/schedule?sportId=1&hydrate=linescore&date=${date}`);
  const data = await res.json();
  const games = data?.dates?.[0]?.games || [];
  const norm = s => (s || "").toLowerCase();
  const lastWord = s => norm(s).split(" ").pop();
  const game = games.find(g => {
    const ht = norm(g.teams?.home?.team?.name || "");
    const at = norm(g.teams?.away?.team?.name || "");
    return ht.includes(lastWord(homeTeam)) && at.includes(lastWord(awayTeam));
  });
  return game?.gamePk ?? null;
}

async function generateParagraph(boxscore, pick, result, edge, tier) {
  const { homeName, awayName, homeRuns, awayRuns, homeHits, awayHits, homeStarter, awayStarter, homeNotables, awayNotables } = boxscore;
  const winner = homeRuns > awayRuns ? homeName : awayName;
  const loser = winner === homeName ? awayName : homeName;
  const wRuns = winner === homeName ? homeRuns : awayRuns;
  const lRuns = winner === homeName ? awayRuns : homeRuns;
  const wHits = winner === homeName ? homeHits : awayHits;
  const wStarter = winner === homeName ? homeStarter : awayStarter;
  const lStarter = winner === homeName ? awayStarter : homeStarter;
  const wNotables = (winner === homeName ? homeNotables : awayNotables) || [];
  const lNotables = (winner === homeName ? awayNotables : homeNotables) || [];
  const edgeStr = edge ? `+${Number(edge).toFixed(1)}%` : null;

  const context = [
    `Game: ${awayName} @ ${homeName}`,
    `Final score: ${winner} ${wRuns}, ${loser} ${lRuns}${wHits != null ? ` (${wHits} hits for the winners)` : ""}`,
    wStarter ? `Winning starter: ${wStarter.name} — ${wStarter.ip} IP, ${wStarter.k} K, ${wStarter.er} ER` : null,
    lStarter ? `Losing starter: ${lStarter.name} — ${lStarter.ip} IP, ${lStarter.k} K, ${lStarter.er} ER` : null,
    wNotables.length ? `Notable winners: ${wNotables.map(n => `${n.name} (${n.h}H, ${n.rbi}RBI${n.hr ? `, ${n.hr}HR` : ""})`).join("; ")}` : null,
    lNotables.length ? `Notable losers: ${lNotables.map(n => `${n.name} (${n.h}H, ${n.rbi}RBI${n.hr ? `, ${n.hr}HR` : ""})`).join("; ")}` : null,
    `Model pick: ${pick}`,
    edgeStr ? `Model edge: ${edgeStr}` : null,
    tier ? `Tier: ${tier}` : null,
    `Bet result: ${result}`,
  ].filter(Boolean).join("\n");

  const prompt = `You are a sharp sports betting analyst writing a post-game recap paragraph for a bettor. Given the game data and bet details below, write a single concise paragraph (3-4 sentences) explaining what happened and why the bet ${result === "win" ? "won" : "lost"}. Be direct, specific, and use the actual player/team names and stats. Don't start with "I" or use filler phrases like "In summary."

${context}

Write the paragraph now:`;

  const msg = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 256,
    messages: [{ role: "user", content: prompt }],
  });

  return msg.content?.[0]?.text?.trim() || null;
}

export async function GET(request) {
  const { error: authError } = await requireAuth(request);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const gamePk = searchParams.get("gamePk");
  const homeTeam = searchParams.get("homeTeam");
  const awayTeam = searchParams.get("awayTeam");
  const date = searchParams.get("date");
  const pick = searchParams.get("pick") || "";
  const result = searchParams.get("result") || "";
  const edge = searchParams.get("edge") || null;
  const tier = searchParams.get("tier") || "";

  try {
    let pk = null;

    if (gamePk && /^\d+$/.test(gamePk)) {
      pk = gamePk;
    }

    if (!pk && homeTeam && awayTeam && date) {
      pk = await findGamePk(homeTeam, awayTeam, date);
    }

    if (!pk) return Response.json({ error: "Game not found" }, { status: 404 });

    const { box, line } = await getBoxscore(pk);
    if (!box?.teams) return Response.json({ error: "No boxscore data" }, { status: 404 });

    const boxscore = parseBoxscore(box, line);
    const paragraph = await generateParagraph(boxscore, pick, result, edge, tier);

    return Response.json({ ...boxscore, paragraph });
  } catch (e) {
    return Response.json({ error: "Failed to fetch game data" }, { status: 500 });
  }
}
