import { buildFreshMLBPicks } from "../../../lib/mlb-picks.js";

// Score a pick for "best available" selection — confidence is primary, edge secondary.
// Works for CLEAN, BET, and PASS picks alike.
function leanScore(p) {
  const conf = p.filter?.confidence || 0;
  const edge = Math.max(p.filter?.trueEdgePct || 0, 0);
  return conf * 2 + edge;
}

// A pick is promotable if it's not a trap, not Coors, and has some pitcher data.
function isPromotable(p) {
  if (p.filter?.verdict === "TRAP") return false;
  if (p.homeTeam === "Colorado Rockies") return false;
  const f = p.filter;
  if (!f) return false; // no filter = no line, can't evaluate
  // exclude picks where the only reason is a catastrophic SP failure
  const catFlags = ["NO_PITCHER_DATA","ERA_XFIP_GAP"];
  const pickSide = p.pick === p.homeTeam ? "HOME_SP" : "AWAY_SP";
  if (catFlags.some(fl => (f.flags || []).includes(`${pickSide}_${fl}`))) return false;
  return true;
}

export async function GET() {
  try {
    const ctParts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(new Date());
    const date = `${ctParts.find(p => p.type === "year").value}-${ctParts.find(p => p.type === "month").value}-${ctParts.find(p => p.type === "day").value}`;

    // Always compute live rather than trusting the picks_cache row directly —
    // that row is only overwritten when someone loads the Picks tab, so it can
    // sit stale for hours after odds move or the model/filter changes, causing
    // the free pick to promote a side/verdict the live Picks list no longer
    // agrees with for the same game.
    const picks = await buildFreshMLBPicks(date).catch(() => []);
    const promotable = picks.filter(isPromotable);

    // Tier 1: CLEAN — full edge, passes every filter condition
    const clean = promotable.find(p => p.filter?.verdict === "CLEAN");
    // Tier 2: BET — passes most conditions
    const bet   = promotable.filter(p => p.isBet).sort((a, b) => leanScore(b) - leanScore(a))[0];
    // Tier 3: Best PASS — highest confidence lean even without full filter pass
    const lean  = promotable
      .filter(p => !p.isBet && p.filter?.verdict !== "CLEAN")
      .sort((a, b) => leanScore(b) - leanScore(a))[0];

    const raw = clean || bet || lean || null;

    if (!raw) {
      // Truly no games worth showing — quiet day
      return Response.json({ pick: null, quietDay: true });
    }

    const verdict = raw.filter?.verdict;
    const isEdgePick = verdict === "CLEAN" || raw.isBet;

    const tier = verdict === "CLEAN"
      ? { level: "High",   label: "🔥 Value Pick", emoji: "🔥" }
      : raw.isBet && (raw.filter?.confidence || 0) >= 7
      ? { level: "Medium", label: "✅ Solid Pick",  emoji: "✅" }
      : raw.isBet
      ? { level: "Low",    label: "✅ Bet",          emoji: "✅" }
      : { level: "Low",    label: "👀 Today's Lean", emoji: "👀" };

    return Response.json({ pick: { ...raw, tier }, isEdgePick, promoType: isEdgePick ? "edge" : "lean" });
  } catch (e) {
    return Response.json({ pick: null, error: e.message });
  }
}
