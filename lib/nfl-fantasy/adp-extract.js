// Turns an admin's pasted consensus-ADP list (copied straight from
// FantasyPros/Sleeper/ESPN — no API key needed, and no Claude vision call
// either, unlike the screenshot-based schedule/personnel imports, since
// these lists are already plain text) into {name, position, team, adp}
// rows. Two shapes are tolerated: a CSV export with a header row, or a bare
// ranked list ("1  Ja'Marr Chase  WR  CIN") pasted straight off a webpage —
// row order becomes the ADP when no explicit ADP/rank column is found.
import { NFL_TEAM_ABBREVIATIONS } from "../nfl-team-names.js";

const POSITION_CODES = new Set(["QB", "RB", "WR", "TE", "K", "DST", "DEF"]);

function splitCsvLine(line) {
  const fields = [];
  let cur = "", inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQuotes = false; }
      else cur += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { fields.push(cur.trim()); cur = ""; }
    else cur += c;
  }
  fields.push(cur.trim());
  return fields;
}

function findCol(header, candidates) {
  for (const name of candidates) {
    const idx = header.findIndex((h) => h.toLowerCase().replace(/[^a-z]/g, "") === name);
    if (idx !== -1) return idx;
  }
  return -1;
}

function cleanName(raw) {
  // Strip a trailing bye-week parenthetical some exports glue onto the name
  // field (e.g. "Ja'Marr Chase (10)").
  return (raw || "").replace(/\s*\([^)]*\)\s*$/, "").trim();
}

function cleanPosition(raw) {
  const code = (raw || "").toUpperCase().replace(/[0-9]/g, "").trim();
  return POSITION_CODES.has(code) ? code : null;
}

// Header-driven parse — used when the first line looks like column names,
// which every FantasyPros/Sleeper/ESPN export ships.
function parseWithHeader(lines) {
  const header = splitCsvLine(lines[0]);
  const nameIdx = findCol(header, ["player", "name", "playername"]);
  const posIdx = findCol(header, ["pos", "position"]);
  const teamIdx = findCol(header, ["team", "tm"]);
  const adpIdx = findCol(header, ["adp", "avg", "average", "consensus"]);
  if (nameIdx === -1) return null;

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const fields = splitCsvLine(lines[i]);
    if (!fields.length || !fields[nameIdx]) continue;
    const adp = adpIdx !== -1 ? parseFloat(fields[adpIdx]) : i;
    if (!Number.isFinite(adp)) continue;
    rows.push({
      name: cleanName(fields[nameIdx]),
      position: posIdx !== -1 ? cleanPosition(fields[posIdx]) : null,
      team: teamIdx !== -1 ? (fields[teamIdx] || "").toUpperCase() || null : null,
      adp,
    });
  }
  return rows;
}

// Fallback for a bare pasted list with no recognizable header — "1 Ja'Marr
// Chase WR CIN" or "Ja'Marr Chase, WR, CIN" per line. Row position becomes
// the ADP when the line carries no leading rank number.
function parseBareList(lines) {
  const rows = [];
  lines.forEach((line, i) => {
    const tokens = line.includes(",") ? splitCsvLine(line) : line.split(/\s+/);
    const cleaned = tokens.map((t) => t.trim()).filter(Boolean);
    if (!cleaned.length) return;

    let adp = i + 1;
    if (/^\d+(\.\d+)?\.?$/.test(cleaned[0])) {
      adp = parseFloat(cleaned[0]);
      cleaned.shift();
    }

    let position = null;
    const posAt = cleaned.findIndex((t) => POSITION_CODES.has(t.toUpperCase().replace(/[0-9]/g, "")));
    if (posAt !== -1) { position = cleanPosition(cleaned[posAt]); cleaned.splice(posAt, 1); }

    // Only a real NFL abbreviation counts as a team — guards against name
    // initials like "AJ"/"DJ"/"CJ" being mistaken for one.
    let team = null;
    const teamAt = cleaned.findIndex((t) => NFL_TEAM_ABBREVIATIONS.has(t.toUpperCase()));
    if (teamAt !== -1) { team = cleaned[teamAt].toUpperCase(); cleaned.splice(teamAt, 1); }

    const name = cleanName(cleaned.join(" "));
    if (!name) return;
    rows.push({ name, position, team, adp });
  });
  return rows;
}

export function parseAdpText(text) {
  const lines = (text || "")
    .split("\n")
    .map((l) => l.replace(/\r$/, "").trim())
    .filter(Boolean);
  if (!lines.length) return [];

  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase().replace(/[^a-z]/g, ""));
  const looksLikeHeader = header.some((h) => ["player", "name", "pos", "position", "adp"].includes(h));

  const rows = looksLikeHeader ? parseWithHeader(lines) : null;
  return rows || parseBareList(lines);
}
