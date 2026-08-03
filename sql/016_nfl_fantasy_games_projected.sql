-- Adds the games-projected count that produced each row's season-total
-- projected/ceiling/floor points (sql/012_nfl_fantasy.sql), so per-game
-- rates can be derived downstream (lib/nfl-fantasy/probability.js's
-- weekly start/sit probability) without re-deriving a different games
-- estimate than the one actually used to build the season totals.
-- Run manually against the Supabase project (no migration runner in this repo).

alter table nfl_fantasy_rankings add column if not exists games_projected int;
