// Narrow, column-filtered CSV parser for nflverse's play-by-play files. Those
// run ~15-20x larger than the aggregated stats files (90MB+ vs ~1.6MB for one
// season) with 300+ columns per row — loading the whole thing through
// XLSX.utils.sheet_to_json (materializing every column of every row) risks
// excessive memory use at that size. This only keeps the handful of columns
// the caller actually needs, and still respects quoted fields (nflverse's
// play-description text column can contain embedded commas) so column
// indices don't drift.
function parseCsvLine(line) {
  const fields = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      fields.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  fields.push(cur);
  return fields;
}

export function parseCsvColumns(text, neededColumns) {
  const lines = text.split("\n");
  const header = parseCsvLine(lines[0].replace(/\r$/, "")).map((h) => h.trim());
  const indices = {};
  for (const col of neededColumns) {
    const idx = header.indexOf(col);
    if (idx !== -1) indices[col] = idx;
  }

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, "");
    if (!line) continue;
    const fields = parseCsvLine(line);
    const row = {};
    for (const col of neededColumns) {
      const idx = indices[col];
      row[col] = idx != null ? fields[idx] : undefined;
    }
    rows.push(row);
  }

  return { rows, missingColumns: neededColumns.filter((c) => !(c in indices)) };
}
