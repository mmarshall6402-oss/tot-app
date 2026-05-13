// lib/probability.js

const MLB_API = "https://statsapi.mlb.com/api/v1";

function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}

function normalize(value, min, max) {
  return ((value - min) / (max - min)) * 2 - 1;
}

async function getTeamId(teamName) {
  try {
    const res = await fetch(`${MLB_API}/teams?sportId=1&season=2026`);
    const data = await res.json();
    const team = data?.teams?.find(
      (t) =>
        t.name.toLowerCase().includes(teamName.toLowerCase()) ||
        teamName.toLowerCase().includes(t.teamName?.toLowerCase())
    );
    return team?.id || null;
  } catch { return null; }
}

async function fetchRecentForm(teamId) {
  try {
    const res = await fetch(
      `${MLB_API}/teams/${teamId}/stats?stats=gameLog&group=hitting&season=2026&limit=10`
    );
    const data = await res.json();
    const splits = data?.stats?.[0]?.splits || [];
    if (splits.length === 0) return 0;
    const wins = splits.filter((g) => g.stat?.wins > 0).length;
    const winPct = wins / splits.length;
    const runsScored = splits.reduce((sum, g) => sum + (parseFloat(g.stat?.runs) || 0), 0);
    const runsAllowed = splits.reduce((sum, g) => sum + (parseFloat(g.stat?.rbi) || 0), 0);
    const runDiff = (runsScored - runsAllowed) / splits.length;
    return (winPct - 0.5) + normalize(runDiff, -5, 5) * 0.3;
  } catch { return 0; }
}

async function fetchHomeAwaySplit(teamId, isHome) {
  try {
    const res = await fetch(
      `${MLB_API}/teams/${teamId}/stats?stats=statSplits&group=hitting&season=2026&sitCodes=${isHome ? "h" : "a"}`
    );
    const data = await res.json();
    const splits = data?.stats?.[0]?.splits || [];
    if (splits.length === 0) return 0;
    const winPct = parseFloat(splits[0]?.stat?.winPercentage) || 0.5;
    return winPct - 0.5;
  } catch { return 0; }
}

async function fetchPitcherScore(teamId) {
  try {
    const schedRes = await fetch(
      `${MLB_API}/schedule?sportId=1&hydrate=probablePitcher(note)&season=2026&teamId=${teamId}`
    );
    const schedData = await schedRes.json();
    const todayGame = schedData?.dates?.[0]?.games?.[0];
    const pitcher =
      todayGame?.teams?.home?.team?.id === teamId
        ? todayGame?.teams?.home?.probablePitcher
        : todayGame?.teams?.away?.probablePitcher;
    if (!pitcher?.id) return 0;
    const statRes = await fetch(
      `${MLB_API}/people/${pitcher.id}/stats?stats=season&group=pitching&season=2026`
    );
    const statData = await statRes.json();
    const stats = statData?.stats?.[0]?.splits?.[0]?.stat;
    if (!stats) return 0;
    const era = parseFloat(stats.era) || 4.5;
    const whip = parseFloat(stats.whip) || 1.3;
    const kPer9 = parseFloat(stats.strikeoutsPer9Inn) || 8.0;
    const eraScore = normalize(era, 1.5, 7.0) * -1;
    const whipScore = normalize(whip, 0.8, 2.0) * -1;
    const kScore = normalize(kPer9, 4.0, 14.0);
    return eraScore * 0.4 + whipScore * 0.35 + kScore * 0.25;
  } catch { return 0; }
}

async function fetchInjuryAdjustment(teamId) {
  try {
    const res = await fetch(
      `${MLB_API}/teams/${teamId}/roster?rosterType=injuredList&season=2026`
    );
    const data = await res.json();
    const injured = data?.roster?.length || 0;
    return -Math.min(injured * 0.05, 0.3);
  } catch { return 0; }
}

export async function getModelProbability(game) {
  const { homeTeam, awayTeam } = game;
  const [homeId, awayId] = await Promise.all([
    getTeamId(homeTeam),
    getTeamId(awayTeam),
  ]);
  if (!homeId || !awayId) return 0.5;

  const [
    homeForm, awayForm,
    homeAdvantage, awayDisadvantage,
    homePitcher, awayPitcher,
    homeInjury, awayInjury,
  ] = await Promise.all([
    fetchRecentForm(homeId),
    fetchRecentForm(awayId),
    fetchHomeAwaySplit(homeId, true),
    fetchHomeAwaySplit(awayId, false),
    fetchPitcherScore(homeId),
    fetchPitcherScore(awayId),
    fetchInjuryAdjustment(homeId),
    fetchInjuryAdjustment(awayId),
  ]);

  const score =
    (homeForm - awayForm) * 0.4 +
    (homeAdvantage - awayDisadvantage) * 0.2 +
    (homePitcher - awayPitcher) * 0.3 +
    (homeInjury - awayInjury) * 0.1;

  return sigmoid(score);
}
