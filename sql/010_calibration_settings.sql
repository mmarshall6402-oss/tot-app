-- Per-sport on/off switch for the daily automated recalibration cron
-- (app/api/cron/recalibrate/route.js), plus a manual "pin to this curve"
-- flow layered on top of the existing model_calibration history.
-- Run manually against the Supabase project (no migration runner in this
-- repo, same as sql/009_model_calibration.sql).
--
-- Every daily recalibration already leaves its fitted curve as a row in
-- model_calibration (only the active flag moves) — nothing here changes
-- that. This table just tracks whether the cron is allowed to touch it.
-- No row for a sport = auto-recalibration enabled (default-on, matches
-- today's always-on behavior).

create table if not exists model_recalibration_settings (
  sport        text primary key,
  auto_enabled boolean not null default true,
  updated_at   timestamptz not null default now(),
  updated_by   text
);
