-- Cross-instance cache for NFL player prop odds (see lib/nfl-odds-props.js).
-- The Odds API bills player-props requests at its expensive per-market
-- credit tier, and Start/Sit calls can hit the same handful of popular
-- players' games repeatedly — a pure in-memory cache doesn't help there
-- since serverless instances don't share memory. This table lets every
-- instance (and every retry after a cold start) read the same recently-
-- fetched line instead of re-pulling from The Odds API. Run manually
-- against the Supabase project (no migration runner in this repo).

create table if not exists nfl_prop_lines_cache (
  event_id    text primary key,
  data        jsonb not null,
  fetched_at  timestamptz not null default now()
);
