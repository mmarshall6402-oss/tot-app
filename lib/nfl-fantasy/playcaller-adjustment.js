// Folds playcaller scheme-tendency data
// (data/nfl-fantasy/playcaller-tendencies.json: play-action dropback rate,
// pre-snap motion rate) into ceilingVorp for WR/TE, weighted by how much PA
// and motion actually move receiver efficiency. Same accepted-risk posture
// as the other *-adjustment.js modules: a documented heuristic, not
// backtested.
//
// Sensitivity constants below are FPOE (fantasy points over expected) per
// target, full swing between "with" and "without" splits, read off a video
// graphic (exact values, not estimated):
//   WR  with PA  0.09  vs without -0.14  -> delta 0.23
//   TE  with PA  0.14  vs without  0.01  -> delta 0.13
//   WR  with motion -0.01 vs without -0.16 -> delta 0.15
//   TE  with motion  0.08 vs without  0.02 -> delta 0.06
// RB has no equivalent split in the source chart, so gets no adjustment.
import { assignTiers } from "./tiers.js";

const PA_SCALE = 2;
const MOTION_SCALE = 2;
// Calibrated against the actual 2025 data/nfl-fantasy/playcaller-tendencies.json
// spread: combined (PA + motion) adjustment across all team/position combos
// tops out around 0.19, so 0.4 was unreachable — playcallerNote was always
// null. 0.08 flags roughly the most extreme fifth, same target percentile as
// pace-adjustment.js's NOTE_THRESHOLD.
const NOTE_THRESHOLD = 0.08;
const PA_FPOE_DELTA = { WR: 0.23, TE: 0.13 };
const MOTION_FPOE_DELTA = { WR: 0.15, TE: 0.06 };

// teamData: parsed data/nfl-fantasy/playcaller-tendencies.json `.teams` map
// (team -> { coach, paDropbackRatePct, motionRatePct, ... }). Returns a
// team -> { paDropbackRatePct, motionRatePct, coach } map, keyed uppercase,
// with non-numeric rows dropped.
export function buildPlaycallerAdjustmentByTeam(teamData) {
  const byTeam = new Map();
  for (const [team, stats] of Object.entries(teamData || {})) {
    const paDropbackRatePct = Number(stats.paDropbackRatePct);
    const motionRatePct = Number(stats.motionRatePct);
    if (!Number.isFinite(paDropbackRatePct) || !Number.isFinite(motionRatePct)) continue;
    byTeam.set(team.toUpperCase(), { paDropbackRatePct, motionRatePct, coach: stats.coach || null });
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
export function applyPlaycallerAdjustment(ranked, byTeam) {
  if (!byTeam || !byTeam.size) return ranked.map((p) => ({ ...p, playcallerNote: null }));

  const avgPa = leagueAverage(byTeam, "paDropbackRatePct");
  const avgMotion = leagueAverage(byTeam, "motionRatePct");

  const adjusted = ranked.map((p) => {
    const paDelta = PA_FPOE_DELTA[p.position];
    const motionDelta = MOTION_FPOE_DELTA[p.position];
    const teamData = p.team ? byTeam.get(p.team.toUpperCase()) : null;
    let playcallerAdjustment = 0;
    let playcallerNote = null;

    if (teamData && paDelta != null && motionDelta != null && avgPa != null && avgMotion != null) {
      const paAdj = ((teamData.paDropbackRatePct - avgPa) / avgPa) * paDelta * PA_SCALE;
      const motionAdj = ((teamData.motionRatePct - avgMotion) / avgMotion) * motionDelta * MOTION_SCALE;
      playcallerAdjustment = paAdj + motionAdj;
      if (Math.abs(playcallerAdjustment) >= NOTE_THRESHOLD) {
        playcallerNote = playcallerAdjustment > 0
          ? `PA/motion-heavy scheme (${teamData.coach || p.team})`
          : `PA/motion-light scheme (${teamData.coach || p.team})`;
      }
    }

    return { ...p, ceilingVorp: p.ceilingVorp + playcallerAdjustment, playcallerAdjustment, playcallerNote };
  });

  adjusted.sort((a, b) => b.ceilingVorp - a.ceilingVorp);
  return assignTiers(adjusted).map((p, i) => ({ ...p, rankOverall: i + 1 }));
}
