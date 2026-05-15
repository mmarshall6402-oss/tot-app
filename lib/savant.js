/**
 * lib/savant.js
 *
 * Fetches pitcher hard-hit rate (EV95%) and barrel rate from Baseball Savant's
 * public CSV leaderboard. Updated daily by MLB, no auth required.
 *
 * Hard-hit rate = % of batted balls hit ≥ 95 mph exit velocity.
 * League average is ~35%; elite = <30%; concerning = >42%.
 *
 * Returns: Map of mlb_player_id → { hardHitPct, barrelPct, avgExitVelo }
 */

const SAVANT_URL =
  "https://baseballsavant.mlb.com/leaderboard/statcast?type=pitcher&year=YEAR&min=q&sort=hard_hit_percent&sortDir=desc&csv=true";

let _cache = null;
let _cacheYear = null;
let _cacheTime = 0;
const TTL = 1000 * 60 * 60 * 4; // 4 hours — Savant updates once a day

export async function fetchPitcherHardHit(year = new Date().getFullYear()) {
  if (_cache && _cacheYear === year && Date.now() - _cacheTime < TTL) return _cache;

  try {
    const res = await fetch(SAVANT_URL.replace("YEAR", year));
    if (!res.ok) throw new Error(`Savant ${res.status}`);
    const text = await res.text();
    const lines = text.split("\n").filter(Boolean);

    // Header row: "last_name, first_name","player_id","attempts",...,"ev95percent",...,"brl_percent",...
    // Strip quotes then split — first column has an embedded comma, hence quoted
    const rawHeader = lines[0];
    const cols = parseCSVRow(rawHeader);

    const idIdx         = cols.indexOf("player_id");
    const ev95Idx       = cols.indexOf("ev95percent");
    const brlIdx        = cols.indexOf("brl_percent");
    const avgVeloIdx    = cols.indexOf("avg_hit_speed");

    if (idIdx < 0 || ev95Idx < 0) {
      console.warn("[savant] Unexpected CSV header:", cols.slice(0, 10));
      return new Map();
    }

    const map = new Map();
    for (const line of lines.slice(1)) {
      const row = parseCSVRow(line);
      const id = parseInt(row[idIdx], 10);
      if (!id) continue;
      map.set(id, {
        hardHitPct: parseFloat(row[ev95Idx]) || null,
        barrelPct:  parseFloat(row[brlIdx])  || null,
        avgExitVelo: parseFloat(row[avgVeloIdx]) || null,
      });
    }

    console.log(`[savant] Loaded ${map.size} pitchers for ${year}`);
    _cache = map;
    _cacheYear = year;
    _cacheTime = Date.now();
    return map;
  } catch (e) {
    console.warn("[savant] Fetch failed:", e.message);
    return _cache || new Map();
  }
}

// Minimal CSV row parser that handles quoted fields with embedded commas
function parseCSVRow(line) {
  const fields = [];
  let cur = "", inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuote = !inQuote; continue; }
    if (ch === "," && !inQuote) { fields.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  fields.push(cur.trim());
  return fields;
}
