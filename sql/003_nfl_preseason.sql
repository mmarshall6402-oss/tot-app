-- Adds preseason-testing support to nfl_model_picks. Run manually against the
-- Supabase project (no migration runner in this repo).
--
-- Preseason games let the whole generate -> resolve -> Elo -> record loop get
-- exercised against real results before the regular season starts, without letting
-- unrepresentative preseason play (backups, small samples) pollute nfl_team_elo or
-- the public-facing record shown on the landing page. app/api/cron/nfl-resolve skips
-- Elo/nfl_daily_stats updates for season_type='preseason' rows, and
-- app/api/nfl/daily-record excludes them from the aggregate it returns.

alter table nfl_model_picks
  add column if not exists season_type text not null default 'regular';

create index if not exists nfl_model_picks_season_type_idx on nfl_model_picks (season_type);
