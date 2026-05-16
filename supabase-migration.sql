-- Run this in your Supabase SQL editor (Dashboard → SQL Editor → New query)

create table if not exists subscriptions (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid references auth.users(id) on delete cascade not null,
  stripe_customer_id      text,
  stripe_subscription_id  text unique,
  status                  text not null default 'inactive',
  plan                    text,
  current_period_end      timestamptz,
  created_at              timestamptz default now(),
  updated_at              timestamptz default now()
);

alter table subscriptions enable row level security;

-- Users can only read their own subscription (needed for client-side status check)
create policy "users read own subscription"
  on subscriptions for select
  using (auth.uid() = user_id);

-- Service role (used by webhook) bypasses RLS automatically
