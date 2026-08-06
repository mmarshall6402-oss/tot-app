-- Weekly Start/Sit call counter for free-tier users (see lib/auth.js's
-- requireFantasyCallAllowance and app/api/nfl/fantasy/route.js). Free plan
-- is capped at 3 Start/Sit calls per week; Pro/admin users skip this check
-- entirely, so this table only ever gets rows for free users who've used
-- the feature. Run manually against the Supabase project (no migration
-- runner in this repo).

create table if not exists fantasy_free_usage (
  user_id     text not null,
  week_start  date not null,   -- Monday of the week (America/Chicago), see weekStartDate() in lib/auth.js
  call_count  int not null default 0,
  updated_at  timestamptz not null default now(),
  primary key (user_id, week_start)
);
