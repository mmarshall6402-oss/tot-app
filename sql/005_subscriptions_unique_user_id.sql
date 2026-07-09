-- Fixes a real race in app/api/stripe/webhook/route.js: writeSubscription()
-- used to do select-then-insert-or-update, so two webhook deliveries for the
-- same new user arriving close together (e.g. checkout.session.completed and
-- customer.subscription.created) could both see "no existing row" and both
-- INSERT, leaving duplicate subscriptions rows for one user_id.
-- Run manually against the Supabase project (no migration runner in this repo).

-- If the race already happened before this fix, collapse duplicates first —
-- prefer an 'active'/'trialing' row over a stale one, then the furthest-out
-- current_period_end, dropping the rest per user_id.
with ranked as (
  select id, user_id,
    row_number() over (
      partition by user_id
      order by (status in ('active', 'trialing')) desc, current_period_end desc nulls last, id desc
    ) as rn
  from subscriptions
)
delete from subscriptions
where id in (select id from ranked where rn > 1);

alter table subscriptions
  add constraint subscriptions_user_id_key unique (user_id);
