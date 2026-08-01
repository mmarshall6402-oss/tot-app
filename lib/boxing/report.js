// Reads the Judge Report Card produced by scripts/boxing/build_report_card.js
// Static-file read for now (no DB table yet) — mirrors the seed-file half of
// lib/elo-db.js. Swap for a Supabase table once the boxing vertical needs
// live writes (e.g. a scheduled re-parse job).
import { readFileSync } from "fs";
import { join } from "path";

export function getJudgeReportCard() {
  const path = join(process.cwd(), "data/boxing/judge_report_card.json");
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}
