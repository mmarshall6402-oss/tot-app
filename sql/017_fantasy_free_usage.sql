-- Weekly Start/Sit call counter for free-tier users (see lib/auth.js's
-- requireFantasyCallAllowance and app/api/nfl/fantasy/route.js). Free plan
-- is capped at 3 Start/Sit calls per week; Pro/admin users skip this check
-- entirely, so this table only ever gets rows for free users who've used
-- the feature.
-- Applied via `npm run migrate` (scripts/migrate.js), tracked in schema_migrations.

create table if not exists fantasy_free_usage (
  user_id     text not null,
  week_start  date not null,   -- Tuesday of the fantasy week (America/Chicago), see weekStartDate() in lib/auth.js
  call_count  int not null default 0,
  updated_at  timestamptz not null default now(),
  primary key (user_id, week_start)
);

-- Atomic check-and-increment: runs as one statement so two concurrent
-- requests can't both read "under the limit" and both slip through as the
-- Nth+1 call. Returns allowed=false (without incrementing) once call_count
-- has reached p_limit; otherwise increments and returns allowed=true.
create or replace function increment_fantasy_usage(p_user_id text, p_week_start date, p_limit int)
returns table(allowed boolean, call_count int) as $$
declare
  v_count int;
begin
  insert into fantasy_free_usage as f (user_id, week_start, call_count, updated_at)
  values (p_user_id, p_week_start, 1, now())
  on conflict (user_id, week_start) do update
    set call_count = f.call_count + 1, updated_at = now()
    where f.call_count < p_limit
  returning f.call_count into v_count;

  if v_count is null then
    select f.call_count into v_count from fantasy_free_usage f
      where f.user_id = p_user_id and f.week_start = p_week_start;
    return query select false, coalesce(v_count, 0);
  else
    return query select true, v_count;
  end if;
end;
$$ language plpgsql;
