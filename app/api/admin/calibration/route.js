// app/api/admin/calibration/route.js
// Private admin route — protected by admin email allowlist (same pattern as
// app/api/admin/tracker/route.js).
//
// Lets an admin see the full history of fitted calibration curves (one per
// recalibration run, cron or manual — see lib/calibration-db.js), roll back
// to a specific past curve, and pause/resume the daily automated
// recalibration cron (app/api/cron/recalibrate/route.js).

import { createClient } from "@supabase/supabase-js";
import { requireAuth } from "../../../../lib/auth.js";
import {
  listCalibrationCurves,
  activateCalibrationCurveById,
  isAutoRecalibrationEnabled,
  setAutoRecalibrationEnabled,
} from "../../../../lib/calibration-db.js";

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
    const [history, autoEnabled] = await Promise.all([
      listCalibrationCurves(supabase),
      isAutoRecalibrationEnabled(supabase),
    ]);
    return Response.json({ history, autoEnabled });
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
      const row = await activateCalibrationCurveById(supabase, body.id);
      // Pinning a specific day's curve only means something if the cron
      // can't immediately refit and overwrite it tomorrow morning.
      await setAutoRecalibrationEnabled(supabase, false, "mlb", user.email);
      return Response.json({ activated: row, autoEnabled: false });
    }

    if (body.action === "set-auto") {
      await setAutoRecalibrationEnabled(supabase, !!body.enabled, "mlb", user.email);
      return Response.json({ autoEnabled: !!body.enabled });
    }

    return Response.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
