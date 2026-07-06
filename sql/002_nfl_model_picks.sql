-- Adds per-pick tracking for NFL so results can be resolved and ELO can
-- actually update (previously nfl_team_elo was written by nothing — every
-- NFL game was scored with both teams frozen at the 1500 default forever).
-- Run manually against the Supabase project (no migration runner in this repo).

create table if not exists nfl_model_picks (
  id           bigint generated always as identity primary key,
  date         text not null,           -- 'YYYY-MM-DD', America/Chicago game day
  home_team    text not null,
  away_team    text not null,
  pick         text not null,
  odds         numeric,
  edge         numeric,
  tier         text,
  is_bet       boolean not null default false,
  result       text not null default 'pending',  -- 'pending' | 'win' | 'loss' | 'push'
  home_score   integer,
  away_score   integer,
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz
);

create index if not exists nfl_model_picks_date_result_idx
  on nfl_model_picks (date, result);
