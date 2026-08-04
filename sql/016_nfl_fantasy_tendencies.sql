-- Adds display-only note columns to nfl_fantasy_rankings (sql/012_nfl_fantasy.sql)
-- for the Cheat Sheet badges produced by lib/nfl-fantasy/pace-adjustment.js
-- and lib/nfl-fantasy/playcaller-adjustment.js. Unlike the personnel/schedule
-- signals (sql/014, sql/015), the source data for these two lives in
-- checked-in JSON (data/nfl-fantasy/team-pace.json,
-- data/nfl-fantasy/playcaller-tendencies.json) rather than an
-- uploaded-screenshot table, since it's a one-time chart-read snapshot
-- rather than a per-week/per-season reupload workflow.
-- Run manually against the Supabase project (no migration runner in this repo).

alter table nfl_fantasy_rankings add column if not exists pace_note text;
alter table nfl_fantasy_rankings add column if not exists playcaller_note text;
