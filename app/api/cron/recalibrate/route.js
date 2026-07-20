// app/api/cron/recalibrate/route.js
// Runs daily after resolve (which settles yesterday's picks). Refits the
// isotonic calibration curve on the cached historical replay
// (data/calibration/historical-rows.json, refreshed by
// scripts/backtest/recalibrate.js) blended with today's freshly resolved
// model_picks — the same prediction-vs-outcome data the calibration
// dashboard (app/api/calibration/route.js) already reads — records it as a
// history row, and activates whichever curve (today's new fit or a past
// one) actually scores best against live picks. See
// lib/backtest/run-recalibration.js for the selection logic: daily variance
// in a single fit can only ever improve what's live, never regress it,
// without anyone having to compare dates by hand.
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
      calibrationId: result.calibrationId ?? null,
      selection: result.selection ?? null,
      gameCount: result.curve.gameCount,
      historicalCount: result.historicalCount,
      liveCount: result.liveCount,
      bestLiveBrier: result.bestLiveBrier ?? null,
    });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
