-- Extends the existing saved_picks table (MLB's Tracker tab/table) so the same
-- tab can also track NFL picks instead of duplicating the whole tracker UI a
-- second time. Run manually against the Supabase project (no migration runner
-- in this repo).
--
-- All new columns are nullable or defaulted to values that reproduce today's MLB
-- behavior exactly (sport='mlb', market_type='moneyline') — existing rows and the
-- existing MLB resolve/display flow are unaffected. NFL rows use market_type/line
-- to grade spread and total picks (not just moneyline), and app/api/tracker/resolve
-- writes home_score/away_score/edge directly onto NFL rows since there's no
-- MLB-style model_picks join to source them from (see fetchSaved in app/app/page.js).

alter table saved_picks
  add column if not exists sport text not null default 'mlb',
  add column if not exists market_type text not null default 'moneyline',
  add column if not exists line numeric,
  add column if not exists home_score integer,
  add column if not exists away_score integer,
  add column if not exists edge numeric;

create index if not exists saved_picks_sport_idx on saved_picks (sport);
