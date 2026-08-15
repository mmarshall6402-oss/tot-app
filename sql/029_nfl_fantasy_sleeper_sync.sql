-- Cross-device persistence for the Draft Assistant's Sleeper Sync mode
-- (components/NFLSection.js). Previously the draft id / username lived only
-- in component state — lost on refresh, and with no server-side record at
-- all, opening the Draft tab on a different device meant re-pasting the
-- draft link and re-typing your username from scratch mid-draft.
--
-- Deliberately separate from nfl_fantasy_draft_teams (sql/028): that table
-- is a list of named, explicitly-saved snapshots the user opts into saving.
-- This is a single always-current pointer per user, silently upserted as
-- they type, with no "save" step of its own — whatever draft/username was
-- last active is what resumes on the next device or reload.
--
-- No RLS — same posture as nfl_fantasy_draft_teams (sql/028): every access
-- goes through an API route using requireAuth() (lib/auth.js) plus the
-- service-role key, with ownership enforced by the route's own
-- `.eq("user_id", user.id)` filter.
-- Applied via `npm run migrate` (scripts/migrate.js), tracked in schema_migrations.

create table if not exists nfl_fantasy_sleeper_sync (
  user_id     uuid primary key,
  draft_id    text,
  username    text,
  slot        integer,
  updated_at  timestamptz not null default now()
);
