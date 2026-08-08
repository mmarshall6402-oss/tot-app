-- Daily claimed-vs-skipped counters for app/api/props/route.js's claim_prop_fetch
-- dedup (sql/021_prop_fetch_lock.sql) — proves the dedup is actually preventing
-- duplicate live fetches, shown on the admin Rate Limits tab. One row per day,
-- so this table is naturally bounded (no cleanup job needed), same reasoning as
-- prop_fetch_claims being bounded by its event_id primary key.
-- Run manually against the Supabase project (no migration runner in this repo).

create table if not exists prop_claim_daily_stats (
  date          date primary key,
  claimed_count int not null default 0,
  skipped_count int not null default 0,
  updated_at    timestamptz not null default now()
);

-- Atomic increment, same insert-on-conflict pattern as increment_fantasy_usage
-- (sql/017_fantasy_free_usage.sql) — safe under concurrent requests.
create or replace function record_prop_claim(p_date date, p_claimed boolean)
returns void as $$
begin
  insert into prop_claim_daily_stats as s (date, claimed_count, skipped_count, updated_at)
  values (p_date, case when p_claimed then 1 else 0 end, case when p_claimed then 0 else 1 end, now())
  on conflict (date) do update
    set claimed_count = s.claimed_count + (case when p_claimed then 1 else 0 end),
        skipped_count = s.skipped_count + (case when p_claimed then 0 else 1 end),
        updated_at = now();
end;
$$ language plpgsql;
