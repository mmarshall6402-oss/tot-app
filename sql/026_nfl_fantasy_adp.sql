-- Adds ADP (average draft position, see lib/nfl-fantasy/adp.js) and the
-- value-delta badge shown on the Cheat Sheet: value_delta = adp_rank -
-- rank_overall. Positive means the model ranks the player better than the
-- market drafts them (a value pick still on the board past where the model
-- says they belong); negative means the market drafts them earlier than the
-- model would (a reach relative to the model).
-- Applied via `npm run migrate` (scripts/migrate.js), tracked in schema_migrations.

alter table nfl_fantasy_rankings add column if not exists adp numeric;
alter table nfl_fantasy_rankings add column if not exists adp_rank int;
alter table nfl_fantasy_rankings add column if not exists value_delta int;
