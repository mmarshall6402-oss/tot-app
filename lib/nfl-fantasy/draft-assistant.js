// Draft-day assistant: turns the Cheat Sheet's own rankings (tier,
// value_delta, regression_delta — all already computed by the weekly
// rankings cron) into "what should I actually do with this pick," given
// which players are already off the board and what your own roster still
// needs. Pure/client-safe — no node builtins — so it's shared as-is between
// the manual draft tracker (components/NFLSection.js, no network round trip
// per click) and the Sleeper-sync API route's snake-draft turn math.

export const DEFAULT_ROSTER_SLOTS = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1 };
const FLEX_ELIGIBLE = ["RB", "WR", "TE"];

export function countByPosition(players) {
  const counts = {};
  for (const p of players || []) counts[p.position] = (counts[p.position] || 0) + 1;
  return counts;
}

// Starters still needed per position, plus a FLEX_DEFICIT covering the
// shared RB/WR/TE flex spot(s) — a roster with its starting RBs/WRs/TEs
// filled but no flex-eligible surplus still needs one more before it needs
// a backup QB.
export function computeRosterNeeds(myDraftedPositions, rosterSlots = DEFAULT_ROSTER_SLOTS) {
  const needs = {};
  for (const pos of ["QB", "RB", "WR", "TE"]) {
    needs[pos] = Math.max(0, (rosterSlots[pos] || 0) - (myDraftedPositions[pos] || 0));
  }
  const flexPool = FLEX_ELIGIBLE.reduce((sum, pos) => sum + (myDraftedPositions[pos] || 0), 0);
  const flexRequired = FLEX_ELIGIBLE.reduce((sum, pos) => sum + (rosterSlots[pos] || 0), 0) + (rosterSlots.FLEX || 0);
  needs.FLEX_DEFICIT = Math.max(0, flexRequired - flexPool);
  return needs;
}

// Rank-equivalent bonus per starter slot still needed at a position — a
// marginal RB when you have zero rostered outranks a marginal 4th WR even
// if the WR's raw board rank is a few spots better, since roster
// construction matters as much as one-pick value on draft day. Tuned by
// feel rather than backtested (there's no backtest harness for live-draft
// sequencing the way lib/nfl-fantasy/backtest-runner.js validates
// projections against realized seasons) — adjust if it over/under-corrects
// in practice.
const NEED_BONUS_PER_SLOT = 6;

// rankings: the Cheat Sheet's own rows (must include rank_overall,
// rank_position, position, tier_position, player_id). draftedPlayerIds:
// Set or array of player_id already off the board (anyone's pick, not just
// yours). needs: computeRosterNeeds() output for your own roster.
export function rankAvailable(rankings, draftedPlayerIds, needs) {
  const draftedSet = draftedPlayerIds instanceof Set ? draftedPlayerIds : new Set(draftedPlayerIds || []);
  const available = (rankings || []).filter((p) => !draftedSet.has(p.player_id));

  // "Last player in a tier" — the single most useful line on a draft board:
  // once this player's gone, the position takes a real quality cliff before
  // the next tier. Computed within each position's own available list so it
  // lines up with tier_position (sql/024_nfl_fantasy_position_tier.sql)
  // rather than the cross-position tier.
  const byPosition = {};
  for (const p of available) (byPosition[p.position] ||= []).push(p);
  const lastInTierIds = new Set();
  for (const list of Object.values(byPosition)) {
    const sorted = [...list].sort((a, b) => (a.rank_position ?? 0) - (b.rank_position ?? 0));
    sorted.forEach((p, i) => {
      const next = sorted[i + 1];
      if (next && next.tier_position !== p.tier_position) lastInTierIds.add(p.player_id);
    });
  }

  return available
    .map((p) => {
      const needSlots = FLEX_ELIGIBLE.includes(p.position)
        ? (needs?.[p.position] || 0) + (needs?.FLEX_DEFICIT > 0 ? 0.5 : 0)
        : (needs?.[p.position] || 0);
      return {
        ...p,
        needSlots,
        recommendScore: (p.rank_overall ?? 999) - needSlots * NEED_BONUS_PER_SLOT,
        lastInTier: lastInTierIds.has(p.player_id),
      };
    })
    .sort((a, b) => a.recommendScore - b.recommendScore);
}

// Slots a drafted roster into starting positions plus FLEX, best rank_overall
// first per position, everyone else falling to bench — turns a flat pick
// list into an actual lineup card. Ties broken by draft order (stable sort)
// since two same-rank players can't both claim the higher slot otherwise.
export function buildLineup(players, rosterSlots = DEFAULT_ROSTER_SLOTS) {
  const byRank = [...(players || [])].sort((a, b) => (a.rank_overall ?? 999) - (b.rank_overall ?? 999));
  const remaining = new Set(byRank.map((p) => p.player_id));

  const starters = [];
  for (const pos of ["QB", "RB", "WR", "TE"]) {
    const count = rosterSlots[pos] || 0;
    const atPos = byRank.filter((p) => p.position === pos && remaining.has(p.player_id));
    for (let i = 0; i < count; i++) {
      const p = atPos[i] || null;
      if (p) remaining.delete(p.player_id);
      starters.push({ slot: count > 1 ? `${pos}${i + 1}` : pos, position: pos, player: p });
    }
  }

  const flexCount = rosterSlots.FLEX || 0;
  const flexPool = byRank.filter((p) => FLEX_ELIGIBLE.includes(p.position) && remaining.has(p.player_id));
  for (let i = 0; i < flexCount; i++) {
    const p = flexPool[i] || null;
    if (p) remaining.delete(p.player_id);
    starters.push({ slot: flexCount > 1 ? `FLEX${i + 1}` : "FLEX", position: "FLEX", player: p });
  }

  const bench = byRank.filter((p) => remaining.has(p.player_id));
  return { starters, bench };
}

// Snake-draft turn math. pickNo and mySlot are both 1-based.
export function pickToSlot(pickNo, numTeams) {
  const round = Math.floor((pickNo - 1) / numTeams) + 1;
  const posInRound = ((pickNo - 1) % numTeams) + 1;
  const slot = round % 2 === 1 ? posInRound : numTeams - posInRound + 1;
  return { round, slot };
}

// How many picks (by anyone) happen before mySlot is next on the clock,
// starting from currentPickNo. 0 means mySlot is on the clock right now.
// Searches at most 2 full rounds — plenty, since snake order guarantees
// every slot picks at least once per round.
export function picksUntilSlot(currentPickNo, numTeams, mySlot) {
  for (let pick = currentPickNo; pick < currentPickNo + numTeams * 2; pick++) {
    if (pickToSlot(pick, numTeams).slot === mySlot) return pick - currentPickNo;
  }
  return null;
}
