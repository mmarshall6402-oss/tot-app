-- Expected-vs-actual regression column and usage change flag for the Cheat
-- Sheet (see lib/nfl-fantasy/regression.js), computed from the current
-- season's rows in nfl_fantasy_stats_player / nfl_fantasy_snap_counts
-- (sql/025_nflverse_daily_ingest.sql).
--
-- regression_delta = actual_ppg - projected_ppg: positive means a player is
-- outperforming their preseason projection (hot start, often a sell-high/
-- regression-risk signal); negative means they're underperforming (cold
-- start, often a buy-low candidate). Null until a player has played enough
-- games this season for the signal to mean anything.
--
-- change_note flags a >=15-point week-over-week swing in offense snap share
-- — an early usage-change signal the season-long projection has no way to
-- see yet — same free-text-pill shape as personnel_note/pace_note/
-- playcaller_note (sql/015, sql/016 and friends) already on this table.
-- Applied via `npm run migrate` (scripts/migrate.js), tracked in schema_migrations.

alter table nfl_fantasy_rankings add column if not exists projected_ppg numeric;
alter table nfl_fantasy_rankings add column if not exists actual_ppg numeric;
alter table nfl_fantasy_rankings add column if not exists games_played_actual int;
alter table nfl_fantasy_rankings add column if not exists regression_delta numeric;
alter table nfl_fantasy_rankings add column if not exists change_note text;
