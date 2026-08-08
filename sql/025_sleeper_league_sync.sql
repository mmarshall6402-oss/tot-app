-- Sleeper account linking + league selection for "My Team" (roster + live
-- draft sync). Rosters, drafts, and league metadata themselves are never
-- persisted here — Sleeper's API is free, fast, and always current, so
-- those are fetched live on each request (see lib/nfl-fantasy/sleeper.js's
-- league-sync functions). This table only stores the small, durable bit:
-- which Sleeper identity and which league a given app user has linked.
-- Applied via `npm run migrate` (scripts/migrate.js), tracked in schema_migrations.

create table if not exists sleeper_links (
  user_id           text primary key,  -- app user id (Supabase auth uuid), matches subscriptions.user_id
  sleeper_user_id   text not null,
  sleeper_username  text not null,
  display_name      text,
  avatar            text,
  linked_at         timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists sleeper_links_sleeper_user_id_idx on sleeper_links (sleeper_user_id);

create table if not exists sleeper_league_selections (
  user_id         text not null,
  league_id       text not null,
  season          text not null,
  league_name     text,
  roster_id       int,
  scoring_format  text,   -- 'ppr' | 'half_ppr' | 'standard', derived from the league's scoring_settings for joining nfl_fantasy_rankings
  selected_at     timestamptz not null default now(),
  primary key (user_id, league_id)
);

create index if not exists sleeper_league_selections_user_idx on sleeper_league_selections (user_id);
