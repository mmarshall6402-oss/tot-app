-- Phase 1: NFL spread + moneyline picks model.
-- Run manually against the Supabase project (no migration runner in this repo).
-- New, standalone tables — does not touch the live MLB picks_cache/model_picks
-- tables, so there's no risk to the existing production MLB pick flow.

create table if not exists nfl_team_elo (
  team_name  text primary key,
  elo        numeric not null default 1500,
  updated_at timestamptz not null default now()
);

-- Mirrors picks_cache's shape exactly, scoped to NFL only.
-- date: 'YYYY-MM-DD' for a day's picks cache, or '__odds__' as the raw-odds
-- cache sentinel row (same convention as picks_cache's ODDS_CACHE_KEY).
create table if not exists nfl_picks_cache (
  date         text primary key,
  picks        jsonb not null,
  generated_at timestamptz not null default now()
);
