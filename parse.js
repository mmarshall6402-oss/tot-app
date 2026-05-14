import fs from 'fs';

const TEAM_MAP = {
  'LAN': 'Los Angeles Dodgers',
  'SDN': 'San Diego Padres',
  'NYA': 'New York Yankees',
  'NYN': 'New York Mets',
  'CHA': 'Chicago White Sox',
  'CHN': 'Chicago Cubs',
  'KCA': 'Kansas City Royals',
  'ANA': 'Los Angeles Angels',
  'SLN': 'St. Louis Cardinals',
  'SFN': 'San Francisco Giants',
  'TBA': 'Tampa Bay Rays',
  'MIL': 'Milwaukee Brewers',
  'MIN': 'Minnesota Twins',
  'HOU': 'Houston Astros',
  'ATL': 'Atlanta Braves',
  'BOS': 'Boston Red Sox',
  'SEA': 'Seattle Mariners',
  'TEX': 'Texas Rangers',
  'TOR': 'Toronto Blue Jays',
  'CLE': 'Cleveland Guardians',
  'DET': 'Detroit Tigers',
  'BAL': 'Baltimore Orioles',
  'PHI': 'Philadelphia Phillies',
  'ARI': 'Arizona Diamondbacks',
  'COL': 'Colorado Rockies',
  'MIA': 'Miami Marlins',
  'PIT': 'Pittsburgh Pirates',
  'CIN': 'Cincinnati Reds',
  'OAK': 'Oakland Athletics',
  'WAS': 'Washington Nationals',
};

function parseGameLog(filepath) {
  const lines = fs.readFileSync(filepath, 'utf8').trim().split('\n');
  const games = [];

  for (const line of lines) {
    const fields = line.split(',').map(f => f.replace(/"/g, '').trim());

    const date = fields[0];
    const awayCode = fields[3];
    const homeCode = fields[6];
    const awayScore = parseInt(fields[9]);
    const homeScore = parseInt(fields[10]);

    if (isNaN(awayScore) || isNaN(homeScore)) continue;

    games.push({
      date,
      awayTeam: TEAM_MAP[awayCode] || awayCode,
      homeTeam: TEAM_MAP[homeCode] || homeCode,
      awayCode,
      homeCode,
      awayScore,
      homeScore,
      homeWon: homeScore > awayScore,
    });
  }

  return games;
}

// parse all 3 years
const games2022 = parseGameLog('./gl2022.txt');
const games2023 = parseGameLog('./gl2023.txt');
const games2024 = parseGameLog('./gl2024.txt');

const allGames = [...games2022, ...games2023, ...games2024]
  .sort((a, b) => a.date.localeCompare(b.date));

console.log(`Total games loaded: ${allGames.length}`);
console.log('Sample:', allGames[0]);

// save to json for next step
fs.writeFileSync('./data/games.json', JSON.stringify(allGames, null, 2));
console.log('Saved to data/games.json');
