-- Adds a within-position tier alongside the existing cross-position `tier`
-- column on nfl_fantasy_rankings. `tier` runs the gap-detection algorithm
-- (lib/nfl-fantasy/tiers.js) over the full player pool, so filtering the
-- Cheat Sheet down to one position leaves large, uneven gaps between the
-- tier numbers that survive the filter (e.g. RB tiers 1, 3, 3, 7, 7...) since
-- those breaks were found against players of other positions that got
-- filtered out. `tier_position` reruns the same algorithm within each
-- position's players only, so a position-filtered board gets its own
-- contiguous 1, 2, 3... tiering.
-- Run manually against the Supabase project (no migration runner in this repo).

alter table nfl_fantasy_rankings add column if not exists tier_position int;
