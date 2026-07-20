-- Adds a column to persist every player prop projection computed for a
-- date (pitcher K + batter HR), not just the edge-filtered top 20 that
-- `picks` already stores. Powers the "All Props" section of the Props tab
-- so any player with a posted line today is browsable, not only the
-- highest-edge "Star Players" subset.
-- Additive only — does not alter existing prop_picks_cache columns or rows.

alter table prop_picks_cache
  add column if not exists all_picks jsonb not null default '[]'::jsonb;
