-- Run this in your Supabase SQL editor (Dashboard → SQL Editor → New query)

create table if not exists subscriptions (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid references auth.users(id) on delete cascade not null unique,
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

-- Email list for free pick subscribers
create table if not exists email_list (
  id         uuid primary key default gen_random_uuid(),
  email      text unique not null,
  source     text default 'landing',
  created_at timestamptz default now()
);

alter table email_list enable row level security;
-- Service role handles all reads/writes (no public access)

-- ML feature vector — stored alongside each pick for future training
-- Run: alter table model_picks add column if not exists features jsonb;

-- Access codes — share with friends/family to bypass paywall
create table if not exists access_codes (
  id         uuid primary key default gen_random_uuid(),
  code       text unique not null,
  label      text,                        -- e.g. "brother Mike"
  uses_max   int default null,            -- null = unlimited
  uses_count int default 0,
  expires_at timestamptz default null,    -- null = never
  created_at timestamptz default now()
);
alter table access_codes enable row level security;
-- Public read for code validation (anon can check if a code is valid)
create policy "public read access_codes"
  on access_codes for select using (true);
