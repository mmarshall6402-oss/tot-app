// GET /api/nfl/fantasy/draft?draftId=...&format=ppr&slot=4
// Live Sleeper draft sync for the On-The-Clock assistant
// (components/NFLSection.js, fantasyMode "draft"). Not Pro-gated, matching
// the rest of the Fantasy tab. Polled client-side on an interval — this
// route itself does no caching since a live draft is stale the instant
// it's fetched.
//
// Sleeper's pick objects are keyed by Sleeper's own player_id, which has no
// direct relationship to nflverse's gsis_id (the id nfl_fantasy_rankings
// uses). Bridged via espn_id: fetchSleeperPlayerIndex() already carries
// espn_id per Sleeper player, and nfl_fantasy_rankings stores espn_id per
// row (crosswalked at write time — see app/api/cron/nfl-fantasy-rankings).
// A pick that can't be bridged that way (rare — Sleeper's index sometimes
// lacks espn_id for very recent call-ups) falls back to matching the pick's
// own name against the rankings by normalizeName, same "don't drop a real
// player over a missing crosswalk row" posture as lib/nfl-fantasy/id-map.js.
import { createClient } from "@supabase/supabase-js";
import { requireAuth } from "../../../../../lib/auth.js";
import { fetchDraft, fetchDraftPicks, fetchSleeperPlayerIndex } from "../../../../../lib/nfl-fantasy/sleeper.js";
import { normalizeName } from "../../../../../lib/nfl-fantasy/id-map.js";
import { pickToSlot, picksUntilSlot } from "../../../../../lib/nfl-fantasy/draft-assistant.js";

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const VALID_FORMATS = new Set(["ppr", "half_ppr", "standard"]);

// Same rule used elsewhere in this codebase (app/api/cron/nfl-fantasy-rankings,
// app/api/cron/nflverse-ingest): NFL season "year" runs Sept-Feb.
function currentNflSeason(now = new Date()) {
  return now.getMonth() >= 2 ? now.getFullYear() : now.getFullYear() - 1;
}

export async function GET(request) {
  const { error: authError } = await requireAuth(request);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const draftId = searchParams.get("draftId");
  const format = searchParams.get("format") || "ppr";
  const slot = searchParams.get("slot") ? parseInt(searchParams.get("slot"), 10) : null;

  if (!draftId) return Response.json({ error: "draftId is required" }, { status: 400 });
  if (!VALID_FORMATS.has(format)) return Response.json({ error: "format must be ppr, half_ppr, or standard" }, { status: 400 });

  const draft = await fetchDraft(draftId);
  if (!draft) return Response.json({ error: "Could not load that Sleeper draft — double check the draft ID." }, { status: 502 });

  const picks = await fetchDraftPicks(draftId);
  const numTeams = draft.settings?.teams || Object.keys(draft.slot_to_roster_id || {}).length || 12;

  const sleeperIndex = await fetchSleeperPlayerIndex();

  const supabase = getSupabase();
  const { data: rankingRows } = await supabase
    .from("nfl_fantasy_rankings")
    .select("player_id, espn_id, name")
    .eq("scoring_format", format)
    .eq("season", currentNflSeason());

  const byEspnId = new Map();
  const byName = new Map();
  for (const r of rankingRows || []) {
    if (r.espn_id) byEspnId.set(String(r.espn_id), r.player_id);
    if (r.name) byName.set(normalizeName(r.name), r.player_id);
  }

  const draftedPlayerIds = [];
  const myDraftedPlayerIds = [];
  let unmatched = 0;
  for (const pick of picks) {
    const sleeperPlayer = sleeperIndex.get(String(pick.player_id));
    let playerId = sleeperPlayer?.espnId ? byEspnId.get(sleeperPlayer.espnId) : null;
    if (!playerId) {
      const fallbackName = sleeperPlayer?.name || [pick.metadata?.first_name, pick.metadata?.last_name].filter(Boolean).join(" ");
      if (fallbackName) playerId = byName.get(normalizeName(fallbackName));
    }
    // Kickers/DST and anyone the crosswalk can't bridge don't appear on the
    // QB/RB/WR/TE Cheat Sheet anyway, so they're not "missing" — just out
    // of scope. Only worth counting for the response, not erroring on.
    if (!playerId) { unmatched++; continue; }
    draftedPlayerIds.push(playerId);
    if (slot != null && pick.draft_slot === slot) myDraftedPlayerIds.push(playerId);
  }

  const currentPickNo = picks.length + 1;
  const { round, slot: pickSlot } = pickToSlot(currentPickNo, numTeams);
  const onTheClock = slot != null && pickSlot === slot;
  const picksUntilYou = slot == null ? null : (onTheClock ? 0 : picksUntilSlot(currentPickNo, numTeams, slot));

  return Response.json({
    numTeams,
    currentPickNo,
    round,
    status: draft.status || null,
    onTheClock,
    picksUntilYou,
    draftedPlayerIds,
    myDraftedPlayerIds,
    unmatchedPicks: unmatched,
  });
}
