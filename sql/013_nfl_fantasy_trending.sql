-- Adds the Sleeper live trending-adds signal to an already-deployed
-- nfl_fantasy_rankings table (sql/012_nfl_fantasy.sql).
-- Applied via `npm run migrate` (scripts/migrate.js), tracked in schema_migrations.

alter table nfl_fantasy_rankings add column if not exists trending_add_count int;
