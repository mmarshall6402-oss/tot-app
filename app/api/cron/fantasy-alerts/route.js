// Runs Tuesday mornings — the "watches your Sleeper roster all week and
// tells you what changed" alert from the product plan. For every user with
// an active subscription and a synced Sleeper league, diffs their roster
// against two signals and emails only the players that actually moved:
//   - depth-chart position/order and injury status, vs. last week's stored
//     snapshot (nfl_fantasy_role_snapshots)
//   - offense snap share, week over week, from the current season's
//     nflverse snap_counts (nflverse_data_cache, kept fresh by
//     app/api/cron/nflverse-refresh, which must run before this does)
// Silent (no email) for a user with zero changes — this is meant to be the
// opposite of the "flood the zone" pattern the rest of the fantasy
// industry runs in-season.
//
// First-ever run for any given player has no prior role snapshot, so it
// reports no depth-chart/injury change for that player (see
// detectRoleChanges) — that week just establishes the baseline everyone
// else diffs against going forward. Snap share doesn't need this bootstrap
// since nflverse's weekly rows are already a time series within the season.
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { timingSafeEqual } from "../../../../lib/auth.js";
import { fetchSleeperPlayerIndex, fetchLeagueRosters } from "../../../../lib/nfl-fantasy/sleeper.js";
import { detectRoleChanges, buildSnapshotRows } from "../../../../lib/nfl-fantasy/alerts.js";
import { detectSnapShareChanges } from "../../../../lib/nfl-fantasy/snap-share.js";
import { currentNflSeason } from "../../../../lib/nfl-fantasy/season.js";

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://thisthatpicks.com";

function changeRowHtml(c) {
  const label = c.type === "injury" ? "INJURY" : c.type === "snap_share" ? "SNAP SHARE" : "DEPTH CHART";
  const color = c.type === "snap_share" ? (c.deltaPct < 0 ? "#FF6B6B" : "#00FF87") : c.type === "injury" ? "#FF6B6B" : "#00FF87";
  return `<div style="padding:12px 0;border-bottom:1px solid #111;">
    <div style="font-size:10px;color:${color};letter-spacing:1px;font-weight:700;margin-bottom:4px;">${label}</div>
    <div style="font-size:14px;font-weight:700;margin-bottom:2px;">${c.name} <span style="color:#444;font-weight:400;">(${c.position})</span></div>
    <div style="font-size:13px;color:#888;">${c.from} → ${c.to}</div>
  </div>`;
}

function buildDigestHtml(changes) {
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#000;font-family:'Helvetica Neue',Arial,sans-serif;color:#fff;">
  <div style="max-width:480px;margin:0 auto;padding:32px 20px;">
    <div style="text-align:center;margin-bottom:24px;">
      <div style="font-size:24px;font-weight:700;letter-spacing:-1px;font-family:monospace;">T<span style="color:#00FF87;">|</span>T</div>
      <div style="font-size:11px;color:#333;letter-spacing:2px;margin-top:4px;">YOUR TEAM — WHAT CHANGED</div>
    </div>
    <div style="background:#080808;border:1px solid #1a1a1a;border-radius:14px;padding:18px 20px;margin-bottom:20px;">
      ${changes.map(changeRowHtml).join("")}
    </div>
    <div style="text-align:center;">
      <a href="${APP_URL}" style="display:inline-block;background:#00FF87;color:#000;text-decoration:none;font-weight:800;font-size:14px;padding:12px 28px;border-radius:10px;">
        Open My Team →
      </a>
    </div>
  </div>
</body></html>`;
}

export async function GET(request) {
  const authHeader = request.headers.get("authorization")?.replace("Bearer ", "");
  if (!timingSafeEqual(authHeader, process.env.CRON_SECRET)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!process.env.RESEND_API_KEY) {
    return Response.json({ error: "RESEND_API_KEY not set" }, { status: 500 });
  }

  const supabase = getSupabase();

  // Idempotency guard, same sentinel-row convention as cron/weekly — a
  // retried invocation on the same day must not double-email everyone.
  const todayKey = new Date().toISOString().slice(0, 10);
  const markerKey = `__fantasy_alerts_${todayKey}__`;
  const { data: alreadySent } = await supabase.from("picks_cache").select("date").eq("date", markerKey).single();
  if (alreadySent) return Response.json({ sent: 0, reason: "already ran today" });

  const { data: selections } = await supabase
    .from("sleeper_league_selections")
    .select("user_id, league_id, roster_id");
  if (!selections?.length) return Response.json({ sent: 0, reason: "no synced leagues" });

  const userIds = [...new Set(selections.map((s) => s.user_id))];
  const { data: subs } = await supabase
    .from("subscriptions")
    .select("user_id, status")
    .in("user_id", userIds);
  const proUserIds = new Set((subs || []).filter((s) => ["active", "trialing"].includes(s.status)).map((s) => s.user_id));

  const activeSelections = selections.filter((s) => proUserIds.has(s.user_id));
  if (!activeSelections.length) return Response.json({ sent: 0, reason: "no Pro users with a synced league" });

  let playerIndex;
  try {
    playerIndex = await fetchSleeperPlayerIndex();
  } catch (e) {
    return Response.json({ error: `Sleeper player index fetch failed: ${e.message}` }, { status: 502 });
  }

  const { data: snapshotRows } = await supabase.from("nfl_fantasy_role_snapshots").select("*");
  const previousSnapshots = new Map((snapshotRows || []).map((r) => [r.sleeper_id, r]));

  // Best-effort — if nflverse-refresh hasn't run yet this season (or at
  // all), snap-share just contributes zero changes rather than failing the
  // whole alert run.
  const season = currentNflSeason();
  const { data: snapCache } = await supabase
    .from("nflverse_data_cache")
    .select("data")
    .eq("dataset", `snap_counts_${season}`)
    .maybeSingle();
  const snapCountsRows = snapCache?.data || [];

  const rosterCacheByLeague = new Map(); // leagueId -> rosters, avoids refetching a league synced by >1 user
  const allSeenSleeperIds = new Set();

  const resend = new Resend(process.env.RESEND_API_KEY);
  const fromAddr = process.env.RESEND_FROM || "T|T Picks <onboarding@resend.dev>";

  let sent = 0, failed = 0, skippedNoChange = 0;

  for (const sel of activeSelections) {
    let rosters = rosterCacheByLeague.get(sel.league_id);
    if (!rosters) {
      try {
        rosters = await fetchLeagueRosters(sel.league_id);
      } catch {
        continue; // one bad league shouldn't sink the whole run
      }
      rosterCacheByLeague.set(sel.league_id, rosters);
    }
    const myRoster = rosters.find((r) => r.rosterId === sel.roster_id);
    if (!myRoster) continue;

    for (const sid of myRoster.players) allSeenSleeperIds.add(sid);

    const changes = [
      ...detectRoleChanges(myRoster.players, playerIndex, previousSnapshots),
      ...detectSnapShareChanges(myRoster.players, playerIndex, snapCountsRows),
    ];
    if (!changes.length) { skippedNoChange++; continue; }

    const { data: userData } = await supabase.auth.admin.getUserById(sel.user_id);
    const email = userData?.user?.email;
    if (!email) continue;

    try {
      await resend.emails.send({
        from: fromAddr,
        to: email,
        subject: `T|T: ${changes.length} change${changes.length > 1 ? "s" : ""} on your team this week`,
        html: buildDigestHtml(changes),
      });
      sent++;
    } catch {
      failed++;
    }
  }

  const snapshotUpdates = buildSnapshotRows([...allSeenSleeperIds], playerIndex);
  if (snapshotUpdates.length) {
    await supabase.from("nfl_fantasy_role_snapshots").upsert(snapshotUpdates, { onConflict: "sleeper_id" });
  }

  await supabase.from("picks_cache").upsert(
    { date: markerKey, picks: [], generated_at: new Date().toISOString() },
    { onConflict: "date" }
  );

  return Response.json({
    sent, failed, skippedNoChange,
    playersSnapshotted: snapshotUpdates.length,
    snapCountsRowsUsed: snapCountsRows.length,
  });
}
