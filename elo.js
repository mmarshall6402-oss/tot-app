import fs from 'fs';
const DEFAULT_ELO = 1500;
const K = 20;
const HOME_ADVANTAGE = 35;
function expected(eloA, eloB) {
  return 1 / (1 + Math.pow(10, (eloB - eloA) / 400));
}
function updateElo(ratings, home, away, homeWon) {
  const homeElo = ratings[home] || DEFAULT_ELO;
  const awayElo = ratings[away] || DEFAULT_ELO;
  const expHome = expected(homeElo + HOME_ADVANTAGE, awayElo);
  const actual = homeWon ? 1 : 0;
  ratings[home] = homeElo + K * (actual - expHome);
  ratings[away] = awayElo + K * ((1 - actual) - (1 - expHome));
}
const games = JSON.parse(fs.readFileSync('./data/games.json', 'utf8'));
const ratings = {};
const results = [];
const WARMUP = 1000;
for (let i = 0; i < games.length; i++) {
  const g = games[i];
  const homeElo = ratings[g.homeTeam] || DEFAULT_ELO;
  const awayElo = ratings[g.awayTeam] || DEFAULT_ELO;
  const homeWinProb = expected(homeElo + HOME_ADVANTAGE, awayElo);
  if (i >= WARMUP) {
    const predictedHome = homeWinProb > 0.5;
    const correct = predictedHome === g.homeWon;
    const p = Math.min(Math.max(homeWinProb, 1e-7), 1 - 1e-7);
    const actual = g.homeWon ? 1 : 0;
    const logLoss = -(actual * Math.log(p) + (1 - actual) * Math.log(1 - p));
    const brier = Math.pow(homeWinProb - actual, 2);
    results.push({ correct, logLoss, brier });
  }
  updateElo(ratings, g.homeTeam, g.awayTeam, g.homeWon);
}
const total = results.length;
const accuracy = (results.filter(r => r.correct).length / total * 100).toFixed(2);
const avgLogLoss = (results.reduce((s, r) => s + r.logLoss, 0) / total).toFixed(4);
const avgBrier = (results.reduce((s, r) => s + r.brier, 0) / total).toFixed(4);
console.log('Games evaluated: ' + total);
console.log('Accuracy:        ' + accuracy + '%');
console.log('Log Loss:        ' + avgLogLoss + '  (lower is better)');
console.log('Brier Score:     ' + avgBrier + '  (lower is better)');
console.log('\nTop 10 Elo ratings:');
Object.entries(ratings).sort((a,b) => b[1]-a[1]).slice(0,10).forEach(([team, elo]) => console.log('  ' + team + ': ' + Math.round(elo)));

fs.writeFileSync('./data/elo_ratings.json', JSON.stringify(ratings, null, 2));
console.log('\nSaved Elo ratings to data/elo_ratings.json');