-- Serverless functions can't write to the filesystem, so the in-season
-- weekly refresh (app/api/cron/nflverse-refresh) can't update
-- data/nflverse/*.json the way the manual bulk downloader
-- (scripts/nfl-fantasy/fetch-nflverse.js) does — that script writes to
-- local disk and is meant to be run off-season for *completed* seasons,
-- which don't change. This table holds the CURRENT season's nflverse data
-- instead, refreshed weekly in-season; prior seasons stay served from the
-- committed baseline files.
-- Applied via `npm run migrate` (scripts/migrate.js), tracked in schema_migrations.

create table if not exists nflverse_data_cache (
  dataset     text primary key,  -- 'player_stats_<season>' | 'snap_counts_<season>' | 'players'
  data        jsonb not null,
  row_count   int,
  fetched_at  timestamptz not null default now()
);
