-- Cross-instance claim table so app/api/props/route.js's live per-game prop
-- refresh (fetchEventPlayerProps) doesn't get re-fired by every concurrent
-- serverless instance for the same event. Vercel cold starts mean the
-- in-memory cache in lib/odds-props.js doesn't help across instances, and
-- Props-tab traffic spikes right when lineups post — exactly when many
-- users would otherwise each trigger their own live The Odds API call for
-- the same game, which is what burned through THE_ODDS_API_KEY's quota.
-- Run manually against the Supabase project (no migration runner in this repo).

create table if not exists prop_fetch_claims (
  event_id    text primary key,
  claimed_at  timestamptz not null default now()
);

-- Atomic claim-or-skip, same "insert ... on conflict ... where ... returning"
-- pattern as increment_fantasy_usage (sql/017_fantasy_free_usage.sql): runs
-- as one statement so two concurrent requests can't both see "unclaimed" and
-- both proceed. Returns true (and takes the claim) if no other instance has
-- claimed this event_id within p_ttl_seconds; false if one already has.
create or replace function claim_prop_fetch(p_event_id text, p_ttl_seconds int default 60)
returns boolean as $$
declare
  v_claimed boolean;
begin
  insert into prop_fetch_claims as c (event_id, claimed_at)
  values (p_event_id, now())
  on conflict (event_id) do update
    set claimed_at = now()
    where c.claimed_at < now() - (p_ttl_seconds || ' seconds')::interval
  returning true into v_claimed;

  return coalesce(v_claimed, false);
end;
$$ language plpgsql;
