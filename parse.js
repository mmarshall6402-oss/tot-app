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
      awaySpId:   fields[101]?.replace(/"/g, '').trim() || null,
      awaySp:     fields[102]?.replace(/"/g, '').trim() || null,
      homeSpId:   fields[103]?.replace(/"/g, '').trim() || null,
      homeSp:     fields[104]?.replace(/"/g, '').trim() || null,
      hpUmpId:    fields[79]?.replace(/"/g, '').trim() || null,
      hpUmp:      fields[80]?.replace(/"/g, '').trim() || null,
    });
  }

  return games;
}

// parse all years — 2018-2021 in data/gamelogs/, 2022-2024 in root
const allGames = [
  './data/gamelogs/gl2018.txt',
  './data/gamelogs/gl2019.txt',
  './data/gamelogs/gl2020.txt',
  './data/gamelogs/gl2021.txt',
  './gl2022.txt',
  './gl2023.txt',
  './gl2024.txt',
].flatMap(parseGameLog).sort((a, b) => a.date.localeCompare(b.date));

console.log(`Total games loaded: ${allGames.length}`);
console.log('Sample:', allGames[0]);

// save to json for next step
fs.writeFileSync('./data/games.json', JSON.stringify(allGames, null, 2));
console.log('Saved to data/games.json');
