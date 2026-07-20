// app/api/cron/recalibrate/route.js
// Runs daily after resolve (which settles yesterday's picks). Refits the
// isotonic calibration curve on the cached historical replay
// (data/calibration/historical-rows.json, refreshed by
// scripts/backtest/recalibrate.js) blended with today's freshly resolved
// model_picks, and publishes it as the new active curve — the same
// prediction-vs-outcome data the calibration dashboard
// (app/api/calibration/route.js) already reads, now closing the loop back
// into the live model automatically instead of sitting in a dashboard only
// a human checks.
//
// Respects model_recalibration_settings.auto_enabled: an admin who's rolled
// back to a specific day's curve (app/api/admin/calibration/route.js) needs
// this to actually stay off tomorrow morning, not get silently overwritten.

import { createClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "../../../../lib/auth.js";
import { loadHistoricalCalibrationRows } from "../../../../lib/backtest/historical-rows.js";
import { fetchLiveCalibrationRows } from "../../../../lib/backtest/live-picks.js";
import { runRecalibration } from "../../../../lib/backtest/run-recalibration.js";
import { isAutoRecalibrationEnabled } from "../../../../lib/calibration-db.js";

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function GET(request) {
  const authHeader = request.headers.get("authorization")?.replace("Bearer ", "");
  if (!timingSafeEqual(authHeader, process.env.CRON_SECRET)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabase();

  try {
    if (!(await isAutoRecalibrationEnabled(supabase))) {
      return Response.json({ written: false, skippedReason: "auto-recalibration is paused (an admin pinned a specific curve)" });
    }

    const historicalRows = loadHistoricalCalibrationRows();
    const liveRows = await fetchLiveCalibrationRows(supabase);

    const result = await runRecalibration(supabase, {
      historicalRows,
      liveRows,
      write: true,
      source: "cron",
    });

    return Response.json({
      written: result.written,
      skippedReason: result.skippedReason ?? null,
      calibrationId: result.calibrationId ?? null,
      gameCount: result.curve.gameCount,
      historicalCount: result.historicalCount,
      liveCount: result.liveCount,
      currentActiveBrier: result.currentActiveBrier ?? null,
      newCurveBrier: result.newCurveBrier ?? null,
    });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
