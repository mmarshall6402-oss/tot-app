-- Adds the Sleeper live trending-adds signal to an already-deployed
-- nfl_fantasy_rankings table (sql/012_nfl_fantasy.sql). Run manually against
-- the Supabase project (no migration runner in this repo).

alter table nfl_fantasy_rankings add column if not exists trending_add_count int;
