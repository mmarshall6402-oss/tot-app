// Static team-name → logo-URL lookup for MLB and NFL. Deliberately not an API
// call — every matchup card on the site renders team logos, so this has to be
// synchronous and free. ESPN's team-logo CDN is stable, unauthenticated, and
// already the source the roster/standings fetches in app/api/team/route.js
// pull from, so this is the same asset, just addressed directly instead of
// pulled out of a JSON response.

const ESPN_LOGO = (sport, abbr) => `https://a.espncdn.com/i/teamlogos/${sport}/500/${abbr}.png`;

// Keyed by nickname (the last word(s) of the full team name), lowercased.
// Full names in this codebase come from the MLB Stats API / ESPN APIs
// (see lib/park-factors.js for the canonical MLB name list) — matching on
// nickname suffix avoids needing every "City" + "Name" combination, while
// multi-word nicknames (Red Sox / White Sox) are listed in full so a naive
// single-word suffix ("sox") never has to be a key.
const MLB_NICKNAMES = {
  "diamondbacks": "ari",
  "braves": "atl",
  "orioles": "bal",
  "red sox": "bos",
  "cubs": "chc",
  "white sox": "chw",
  "reds": "cin",
  "guardians": "cle",
  "rockies": "col",
  "tigers": "det",
  "astros": "hou",
  "royals": "kc",
  "angels": "laa",
  "dodgers": "lad",
  "marlins": "mia",
  "brewers": "mil",
  "twins": "min",
  "mets": "nym",
  "yankees": "nyy",
  "athletics": "ath",
  "phillies": "phi",
  "pirates": "pit",
  "padres": "sd",
  "giants": "sf", // MLB Giants — NFL Giants is resolved separately, see below
  "mariners": "sea",
  "cardinals": "stl", // MLB Cardinals — NFL Cardinals resolved separately
  "rays": "tb",
  "rangers": "tex", // MLB Rangers — no NFL "Rangers", no collision
  "blue jays": "tor",
  "nationals": "wsh",
};

const NFL_NICKNAMES = {
  "cardinals": "ari",
  "falcons": "atl",
  "ravens": "bal",
  "bills": "buf",
  "panthers": "car",
  "bears": "chi",
  "bengals": "cin",
  "browns": "cle",
  "cowboys": "dal",
  "broncos": "den",
  "lions": "det",
  "packers": "gb",
  "texans": "hou",
  "colts": "ind",
  "jaguars": "jax",
  "chiefs": "kc",
  "raiders": "lv",
  "chargers": "lac",
  "rams": "lar",
  "dolphins": "mia",
  "vikings": "min",
  "patriots": "ne",
  "saints": "no",
  "giants": "nyg",
  "jets": "nyj",
  "eagles": "phi",
  "steelers": "pit",
  "49ers": "sf",
  "seahawks": "sea",
  "buccaneers": "tb",
  "titans": "ten",
  "commanders": "wsh",
};

function lookup(name, table) {
  const n = (name || "").toLowerCase().trim();
  if (!n) return null;
  // Longer (more specific) keys first, so "red sox" wins over any shorter
  // suffix before a generic one could — none exist today, but this keeps the
  // match order safe if a generic key is ever added.
  const keys = Object.keys(table).sort((a, b) => b.length - a.length);
  const hit = keys.find(k => n.endsWith(k));
  return hit ? table[hit] : null;
}

// sport: "mlb" | "nfl". Returns a logo URL or null if the team isn't recognized.
export function teamLogoUrl(name, sport) {
  const abbr = sport === "nfl" ? lookup(name, NFL_NICKNAMES) : lookup(name, MLB_NICKNAMES);
  if (!abbr) return null;
  return ESPN_LOGO(sport === "nfl" ? "nfl" : "mlb", abbr);
}
