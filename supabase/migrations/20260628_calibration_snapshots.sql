-- Nightly calibration snapshots written by the AWS Lambda pipeline.
-- Each row is one run: full bucket breakdown + scalar metrics (Brier, log loss, avgDelta).
create table if not exists calibration_snapshots (
  id              uuid            primary key default gen_random_uuid(),
  run_at          timestamptz     not null default now(),
  total_picks     integer         not null default 0,
  brier_score     double precision,
  log_loss        double precision,
  avg_delta       double precision,
  prob_buckets    jsonb,
  conf_buckets    jsonb,
  verdict_buckets jsonb,
  variance_buckets jsonb
);

-- Recency queries only ever sort descending on run_at
create index if not exists calibration_snapshots_run_at_idx
  on calibration_snapshots (run_at desc);

alter table calibration_snapshots enable row level security;

-- All reads/writes go through service role key (bypasses RLS).
-- Anon/authenticated roles get nothing.
create policy "no public access"
  on calibration_snapshots
  for all
  using (false);
