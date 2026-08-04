-- Manual admin hand-tuning of NFL fantasy player projections
-- (app/admin/players). A row here wins outright over every computed
-- adjustment (aging curve, injury discount, personnel/pace/playcaller) for
-- that player — see lib/nfl-fantasy/player-override.js, applied last in
-- app/api/cron/nfl-fantasy-rankings so the admin's number is always what
-- ships to the live Cheat Sheet.
-- Run manually against the Supabase project (no migration runner in this repo).

create table if not exists nfl_player_overrides (
  player_id      text primary key,   -- nflverse gsis_id
  name           text not null,
  position       text,
  mean_points    numeric,            -- overrides projection.mean (season total) when set
  floor_points   numeric,            -- overrides projection.p20 when set
  ceiling_points numeric,            -- overrides projection.p80 when set
  note           text,
  updated_at     timestamptz not null default now(),
  updated_by     text
);

alter table nfl_fantasy_rankings add column if not exists manual_override_note text;
