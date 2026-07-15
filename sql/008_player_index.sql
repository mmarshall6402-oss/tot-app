-- Player search index (MLB + NFL), refreshed on a schedule by
-- /api/cron/player-index. Decouples /api/search from the live ~60-team
-- roster crawl that used to run on every search keystroke — search now reads
-- this table directly, so a slow or unreachable external host can never make
-- search silently return nothing.
-- Run manually against the Supabase project (no migration runner in this repo).

create table if not exists player_index (
  sport         text not null,        -- 'mlb' | 'nfl'
  player_id     text not null,
  name          text not null,
  name_lower    text not null,
  team          text,
  position      text,
  injury_status text,                 -- nfl only; null for mlb
  updated_at    timestamptz not null default now(),
  primary key (sport, player_id)
);

create index if not exists player_index_search_idx on player_index (sport, name_lower);
