// GET /api/nfl/fantasy/news — the tracker's news feed: recent ESPN injury
// status transitions (nfl_fantasy_injury_log, populated by
// app/api/cron/player-index) merged with tagged ESPN headlines
// (lib/nfl-fantasy/news.js), each flagged `opportunity: true` when
// lib/nfl-fantasy/teammate-impact.js ties it to one of the user's tracked
// players losing a teammate. Not Pro-gated, matching the rest of the
// Fantasy tab.
import { createClient } from "@supabase/supabase-js";
import { requireAuth } from "../../../../../lib/auth.js";
import { fetchNFLNews } from "../../../../../lib/nfl-fantasy/news.js";
import { computeTeammateImpacts } from "../../../../../lib/nfl-fantasy/teammate-impact.js";

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function currentNflSeason(now = new Date()) {
  return now.getMonth() >= 2 ? now.getFullYear() : now.getFullYear() - 1;
}

export async function GET(request) {
  const { user, error: authError } = await requireAuth(request);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const season = parseInt(searchParams.get("season"), 10) || currentNflSeason();

  const supabase = getSupabase();

  const [{ data: tracked }, { data: injuryLogRows }, { data: playerIndexRows }, news] = await Promise.all([
    supabase.from("nfl_fantasy_tracked_players").select("espn_id, name").eq("user_id", user.id),
    supabase.from("nfl_fantasy_injury_log").select("espn_id, name, team, position, old_status, new_status, changed_at")
      .eq("season", season).order("changed_at", { ascending: false }).limit(100),
    supabase.from("player_index").select("player_id, name, team, position, injury_status").eq("sport", "nfl"),
    fetchNFLNews(),
  ]);

  const trackedEspnIds = new Set((tracked || []).map((t) => t.espn_id));
  const teammateAlerts = computeTeammateImpacts(injuryLogRows || [], playerIndexRows || []);
  const opportunityByInjuredName = new Map(); // injured player's name -> alerts triggered by their transition
  for (const a of teammateAlerts) {
    const list = opportunityByInjuredName.get(a.injuredName) || [];
    list.push(a);
    opportunityByInjuredName.set(a.injuredName, list);
  }

  const injuryItems = (injuryLogRows || []).map((r) => {
    const alerts = opportunityByInjuredName.get(r.name) || [];
    const relevantAlerts = trackedEspnIds.size ? alerts.filter((a) => trackedEspnIds.has(a.affectedEspnId)) : alerts;
    return {
      type: "injury",
      timestamp: r.changed_at,
      name: r.name,
      team: r.team,
      position: r.position,
      oldStatus: r.old_status,
      newStatus: r.new_status,
      opportunity: relevantAlerts.length > 0,
      teammateAlerts: relevantAlerts,
      relevant: trackedEspnIds.size === 0 || trackedEspnIds.has(r.espn_id) || relevantAlerts.length > 0,
    };
  });

  const headlineItems = news.map((n) => {
    const mentionsTracked = trackedEspnIds.size > 0 && n.mentionedPlayers.some((p) => trackedEspnIds.has(p.espnId));
    return {
      type: "headline",
      timestamp: n.published,
      headline: n.headline,
      description: n.description,
      url: n.url,
      mentionedPlayers: n.mentionedPlayers,
      opportunity: false,
      relevant: trackedEspnIds.size === 0 || mentionsTracked,
    };
  });

  const items = [...injuryItems, ...headlineItems]
    .filter((i) => i.relevant)
    .sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0))
    .slice(0, 60)
    .map(({ relevant, ...rest }) => rest);

  return Response.json({ season, items });
}
