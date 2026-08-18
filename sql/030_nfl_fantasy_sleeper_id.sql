-- Adds a direct Sleeper player_id crosswalk to nfl_fantasy_rankings so a
-- live Sleeper draft pick (app/api/nfl/fantasy/draft) can be matched to a
-- ranked player by exact id instead of bridging through espn_id (itself a
-- two-hop join) or, failing that, fuzzy name matching at request time. The
-- espn_id/name fallback chain stays in place for rows written before this
-- column existed or where the crosswalk genuinely can't resolve one (very
-- recent call-ups Sleeper hasn't indexed yet) — this narrows how often that
-- fallback is needed, it doesn't replace it.
-- Applied via `npm run migrate` (scripts/migrate.js), tracked in schema_migrations.

alter table nfl_fantasy_rankings add column if not exists sleeper_id text;
create index if not exists nfl_fantasy_rankings_sleeper_idx on nfl_fantasy_rankings (sleeper_id, scoring_format, season);
