// Folds team-level pace and explosive-play-rate data
// (data/nfl-fantasy/team-pace.json) into ceilingVorp — same accepted-risk
// posture as schedule-adjustment.js and personnel-adjustment.js (a
// documented heuristic, not backtested against this specific signal).
// Faster, more explosive offenses run more snaps and create more big-play
// upside for every skill position, so the boost applies broadly rather than
// being position-exclusive like the PA/motion signal in
// playcaller-adjustment.js — but scaled down for positions whose scoring is
// less snap-count-driven (QB) or whose upside this chart doesn't measure
// directly (RB, since "explosive play rate" here is offense-wide, not
// rush-specific).
import { assignTiers } from "./tiers.js";

const PACE_SCALE = 2;
const EXPLOSIVE_SCALE = 2;
// Calibrated against the actual 2025 data/nfl-fantasy/team-pace.json spread:
// combined (explosive + pace) adjustment across all team/position combos
// tops out around 0.6, so 0.5 flagged almost nothing (3 of 124 combos, and
// the single largest was the LA/LAR key-mismatch case below). 0.25 flags
// roughly the most extreme fifth — a "notable" bar that's actually reachable.
const NOTE_THRESHOLD = 0.25;
const POSITION_RELEVANCE = { WR: 1, TE: 0.8, RB: 0.6, QB: 0.4 };

// teamPaceData: parsed data/nfl-fantasy/team-pace.json `.teams` map (team ->
// { explosivePlayRate15, neutralPace }). Returns the same shape, keyed
// uppercase, with non-numeric rows dropped.
export function buildPaceAdjustmentByTeam(teamPaceData) {
  const byTeam = new Map();
  for (const [team, stats] of Object.entries(teamPaceData || {})) {
    const explosivePlayRate15 = Number(stats.explosivePlayRate15);
    const neutralPace = Number(stats.neutralPace);
    if (!Number.isFinite(explosivePlayRate15) || !Number.isFinite(neutralPace)) continue;
    byTeam.set(team.toUpperCase(), { explosivePlayRate15, neutralPace });
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
export function applyPaceAdjustment(ranked, byTeam) {
  if (!byTeam || !byTeam.size) return ranked.map((p) => ({ ...p, paceNote: null }));

  const avgExplosive = leagueAverage(byTeam, "explosivePlayRate15");
  const avgPace = leagueAverage(byTeam, "neutralPace");

  const adjusted = ranked.map((p) => {
    const relevance = POSITION_RELEVANCE[p.position] ?? 0;
    const teamData = p.team ? byTeam.get(p.team.toUpperCase()) : null;
    let paceAdjustment = 0;
    let paceNote = null;

    if (teamData && relevance && avgExplosive != null && avgPace != null) {
      const explosiveDelta = ((teamData.explosivePlayRate15 - avgExplosive) / avgExplosive) * EXPLOSIVE_SCALE;
      const paceDelta = ((teamData.neutralPace - avgPace) / avgPace) * PACE_SCALE;
      paceAdjustment = (explosiveDelta + paceDelta) * relevance;
      if (Math.abs(paceAdjustment) >= NOTE_THRESHOLD) {
        paceNote = paceAdjustment > 0 ? `Fast/explosive O (${p.team})` : `Slow O (${p.team})`;
      }
    }

    return { ...p, ceilingVorp: p.ceilingVorp + paceAdjustment, paceAdjustment, paceNote };
  });

  adjusted.sort((a, b) => b.ceilingVorp - a.ceilingVorp);
  return assignTiers(adjusted).map((p, i) => ({ ...p, rankOverall: i + 1 }));
}
