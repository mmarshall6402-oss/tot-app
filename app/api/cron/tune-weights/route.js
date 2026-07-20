// app/api/cron/tune-weights/route.js
// Runs weekly (Sundays, after resolve/recalibrate). Live-data-aware weight
// tuning — searches lib/probability.js's top-level factor-scale WEIGHTS
// (pitcher/lineup/bullpen/elo/form/HR) against historical replay blended
// with live resolved picks, and activates whichever vector actually scores
// best on live data. See lib/backtest/run-weight-tuning.js: below a live
// sample threshold this only records a candidate, it never auto-activates
// one — unlike calibration, a weight change can flip which team gets
// picked, so there's no safe "just publish it" fallback while the sample is
// still thin.
//
// Respects model_recalibration_settings.auto_weights_enabled — separate
// switch from calibration's auto_enabled, so either can be paused
// independently from the admin panel.

import { createClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "../../../../lib/auth.js";
import { loadHistoricalWeightComponents } from "../../../../lib/backtest/historical-weight-components.js";
import { fetchLiveWeightRows } from "../../../../lib/backtest/live-weight-rows.js";
import { runWeightTuning } from "../../../../lib/backtest/run-weight-tuning.js";
import { isAutoWeightTuningEnabled } from "../../../../lib/weights-db.js";

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
    if (!(await isAutoWeightTuningEnabled(supabase))) {
      return Response.json({ written: false, skippedReason: "auto weight-tuning is paused (an admin pinned a specific vector)" });
    }

    const historicalRows = loadHistoricalWeightComponents();
    const liveRows = await fetchLiveWeightRows(supabase);

    const result = await runWeightTuning(supabase, {
      historicalRows,
      liveRows,
      write: true,
      source: "cron",
    });

    return Response.json({
      written: result.written,
      weightsId: result.weightsId ?? null,
      selection: result.selection ?? null,
      historicalCount: result.historicalCount,
      liveCount: result.liveCount,
      bestLiveBrier: result.bestLiveBrier ?? null,
      changes: result.changes,
    });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
