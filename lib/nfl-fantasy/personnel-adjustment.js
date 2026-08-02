// Folds uploaded team personnel-usage data (% of snaps in 3+ WR sets vs
// 2-or-fewer WR sets) directly into the ranking number, per explicit
// request — same accepted-risk posture as schedule-adjustment.js (no
// historical data to backtest this specific heuristic against). Unlike the
// run-defense schedule grid, this is a season-long team tendency, not a
// per-week one, so it applies across every week rather than just the
// playoff stretch.
//
// Teams that run more 3+ WR sets spread more routes across WR2/WR3/slot
// receivers — a boost to WR value. Teams that run more 2-or-fewer WR sets
// lean on heavier personnel (2 TE / extra RB), which favors the TE — a
// boost to TE value. Deliberately modest, relative to the league average
// rather than an arbitrary fixed midpoint, and scaled down from the
// run-defense adjustment since it's a softer, more diffuse signal.
import { assignTiers } from "./tiers.js";

const WR_SCALE = 3;
const TE_SCALE = 3;

// rows: raw rows from nfl_fantasy_team_personnel (team, wr3_plus_pct,
// wr2_minus_pct). Returns a team -> { wr3PlusPct, wr2MinusPct } map.
export function buildPersonnelAdjustmentByTeam(rows) {
  const byTeam = new Map();
  for (const row of rows || []) {
    if (!row.team) continue;
    const wr3PlusPct = Number(row.wr3_plus_pct);
    const wr2MinusPct = Number(row.wr2_minus_pct);
    if (!Number.isFinite(wr3PlusPct) || !Number.isFinite(wr2MinusPct)) continue;
    byTeam.set(row.team.toUpperCase(), { wr3PlusPct, wr2MinusPct });
  }
  return byTeam;
}

function leagueAverage(byTeam, key) {
  const vals = [...byTeam.values()].map((v) => v[key]);
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

// Applies the adjustment, then re-sorts and re-assigns tiers/overall rank so
// the reordering is fully reflected — not just a cosmetic number bump.
export function applyPersonnelAdjustment(ranked, byTeam) {
  if (!byTeam || !byTeam.size) return ranked.map((p) => ({ ...p, personnelNote: null }));

  const avgWr3Plus = leagueAverage(byTeam, "wr3PlusPct");
  const avgWr2Minus = leagueAverage(byTeam, "wr2MinusPct");

  const adjusted = ranked.map((p) => {
    const teamData = p.team ? byTeam.get(p.team.toUpperCase()) : null;
    let personnelAdjustment = 0;
    let personnelNote = null;

    if (teamData && p.position === "WR" && avgWr3Plus != null) {
      personnelAdjustment = ((teamData.wr3PlusPct - avgWr3Plus) / 100) * WR_SCALE;
      personnelNote = `${teamData.wr3PlusPct}% 3+WR sets (${p.team})`;
    } else if (teamData && p.position === "TE" && avgWr2Minus != null) {
      personnelAdjustment = ((teamData.wr2MinusPct - avgWr2Minus) / 100) * TE_SCALE;
      personnelNote = `${teamData.wr2MinusPct}% 2-WR sets (${p.team})`;
    }

    return { ...p, ceilingVorp: p.ceilingVorp + personnelAdjustment, personnelAdjustment, personnelNote };
  });

  adjusted.sort((a, b) => b.ceilingVorp - a.ceilingVorp);
  return assignTiers(adjusted).map((p, i) => ({ ...p, rankOverall: i + 1 }));
}
