-- Last-known depth-chart position/order and injury status per Sleeper
-- player, so the weekly alert cron (app/api/cron/fantasy-alerts) can diff
-- "what changed since last week" instead of only ever seeing a snapshot in
-- time. One row per player, not per user — role/injury status isn't
-- user-specific, only which rostered players a given user cares about is.
-- Applied via `npm run migrate` (scripts/migrate.js), tracked in schema_migrations.

create table if not exists nfl_fantasy_role_snapshots (
  sleeper_id            text primary key,
  depth_chart_position  text,
  depth_chart_order     int,
  injury_status         text,
  snapshot_at           timestamptz not null default now()
);
