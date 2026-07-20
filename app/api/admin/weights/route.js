// app/api/admin/weights/route.js
// Private admin route — protected by admin email allowlist (same pattern as
// app/api/admin/tracker and app/api/admin/calibration).
//
// Weight-vector counterpart to app/api/admin/calibration: history of fitted
// WEIGHTS vectors (lib/probability.js), each scored against live picks,
// roll back or snap to the best-scoring one, pause/resume the weekly
// automated tuning cron (app/api/cron/tune-weights/route.js). Kept as a
// separate route/table/switch from calibration's — a weight change can flip
// which team gets picked, calibration only ever rescales confidence, so
// they're paused and reviewed independently.

import { createClient } from "@supabase/supabase-js";
import { requireAuth } from "../../../../lib/auth.js";
import { fetchLiveWeightRows } from "../../../../lib/backtest/live-weight-rows.js";
import { scoreWeightsOnLiveData, pickBestWeights } from "../../../../lib/backtest/score-weights.js";
import {
  listWeightsWithValues,
  activateWeightsById,
  isAutoWeightTuningEnabled,
  setAutoWeightTuningEnabled,
} from "../../../../lib/weights-db.js";

const getSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkAuth(request) {
  const { user } = await requireAuth(request);
  if (!user) return null;
  const admins = (process.env.NEXT_PUBLIC_ADMIN_EMAILS || process.env.NEXT_PUBLIC_ADMIN_EMAIL || "")
    .split(",").map(e => e.trim().toLowerCase()).filter(Boolean);
  return admins.includes(user.email?.toLowerCase()) ? user : null;
}

export async function GET(request) {
  const user = await checkAuth(request);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = getSupabase();
  try {
    const [vectors, liveRows, autoEnabled] = await Promise.all([
      listWeightsWithValues(supabase),
      fetchLiveWeightRows(supabase),
      isAutoWeightTuningEnabled(supabase),
    ]);

    const scored = liveRows.length
      ? scoreWeightsOnLiveData(vectors, liveRows)
      : vectors.map(v => ({ ...v, liveBrier: null, liveN: 0 }));
    const best = liveRows.length ? pickBestWeights(scored) : null;

    const history = scored.map(v => ({
      id: v.id,
      fitted_at: v.fitted_at,
      game_count: v.game_count,
      notes: v.notes,
      active: v.active,
      live_brier: v.liveBrier,
      is_best: best ? v.id === best.id : false,
    }));

    return Response.json({ history, autoEnabled, liveN: liveRows.length });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(request) {
  const user = await checkAuth(request);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = getSupabase();
  const body = await request.json();

  try {
    if (body.action === "activate") {
      if (!body.id) return Response.json({ error: "Missing id" }, { status: 400 });
      const row = await activateWeightsById(supabase, body.id);
      await setAutoWeightTuningEnabled(supabase, false, "mlb", user.email);
      return Response.json({ activated: row, autoEnabled: false });
    }

    if (body.action === "activate-best") {
      const [vectors, liveRows] = await Promise.all([
        listWeightsWithValues(supabase),
        fetchLiveWeightRows(supabase),
      ]);
      if (!liveRows.length) {
        return Response.json({ error: "No resolved live picks with weight_components yet to score vectors against" }, { status: 400 });
      }
      const best = pickBestWeights(scoreWeightsOnLiveData(vectors, liveRows));
      const row = await activateWeightsById(supabase, best.id);
      return Response.json({ activated: row, bestLiveBrier: best.liveBrier });
    }

    if (body.action === "set-auto") {
      await setAutoWeightTuningEnabled(supabase, !!body.enabled, "mlb", user.email);
      return Response.json({ autoEnabled: !!body.enabled });
    }

    return Response.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
