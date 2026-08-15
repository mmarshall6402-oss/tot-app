// GET /api/nfl/fantasy/sleeper-drafts?username=...
// Lists a Sleeper user's drafts for the current NFL season, so Sleeper Sync
// (components/NFLSection.js) can offer "here are your drafts, pick one"
// instead of requiring the user to dig up and paste a draft URL. Not
// Pro-gated, matching the rest of the Draft Assistant.
import { requireAuth } from "../../../../../lib/auth.js";
import { fetchSleeperUser, fetchSleeperUserDrafts } from "../../../../../lib/nfl-fantasy/sleeper.js";

// Same rule used elsewhere in this codebase (app/api/nfl/fantasy/draft,
// app/api/cron/nfl-fantasy-rankings): NFL season "year" runs Sept-Feb.
function currentNflSeason(now = new Date()) {
  return now.getMonth() >= 2 ? now.getFullYear() : now.getFullYear() - 1;
}

// "drafting" first (the one that actually needs attention right now), then
// upcoming, then anything already finished — each group newest-first.
const STATUS_RANK = { drafting: 0, paused: 0, pre_draft: 1, complete: 2 };

export async function GET(request) {
  const { error: authError } = await requireAuth(request);
  if (authError) return authError;

  const username = new URL(request.url).searchParams.get("username");
  if (!username) return Response.json({ error: "username is required" }, { status: 400 });

  const sleeperUser = await fetchSleeperUser(username);
  if (!sleeperUser) return Response.json({ error: `Could not find a Sleeper user named "${username}" — double-check the spelling.` }, { status: 404 });

  const season = currentNflSeason();
  const rawDrafts = await fetchSleeperUserDrafts(sleeperUser.userId, season);

  const drafts = rawDrafts
    .filter((d) => d.sport === "nfl")
    .map((d) => ({
      draftId: d.draft_id,
      leagueName: d.metadata?.name || null,
      status: d.status || "pre_draft",
      numTeams: d.settings?.teams || Object.keys(d.slot_to_roster_id || {}).length || null,
      startTime: d.start_time || null,
    }))
    .sort((a, b) => {
      const rankDiff = (STATUS_RANK[a.status] ?? 1) - (STATUS_RANK[b.status] ?? 1);
      if (rankDiff !== 0) return rankDiff;
      return (b.startTime || 0) - (a.startTime || 0);
    });

  return Response.json({ username: sleeperUser.displayName, drafts });
}
