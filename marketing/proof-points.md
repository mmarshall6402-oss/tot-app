# Proof Points & Claim Guardrails

## Rule #1: never hardcode a performance number into copy

Win rate, record, and edge numbers are live and change daily. Any copy asset (landing page, ad,
social post) that states a number must either:

- Pull it dynamically from `/api/model-record` (MLB) or the NFL equivalent at render time (this is
  how `app/landing/page.js` already does it — see the hero stat strip), or
- Be explicitly dated ("as of [date], our tracked record is X-Y") if it's a static post, and
  re-verified before reuse.

Never reuse a number from a previous piece of content without re-checking it — a stale win rate
posted as current is a factual (and reputational) risk.

## Where the real numbers live

| Claim | Source of truth |
|---|---|
| MLB model win/loss record | `/api/model-record` (also drives `app/record`) |
| MLB daily win % | Same endpoint — `record.pct` in `app/landing/page.js` |
| NFL record | `/api/nfl/today-record`, `/api/nfl/daily-record` |
| Model calibration accuracy | Admin backtest console (`app/admin/backtest`) — internal only, don't publish raw calibration curves without review |
| Fantasy projection accuracy | `lib/nfl-fantasy/backtest-runner.js` output — internal validation, not (yet) a public-facing stat |

## Claims that are safe to make (backed by real, verifiable mechanics)

- "Every pick gets a verdict — CLEAN, BET, PASS, or TRAP." (true, mechanical, in `lib/filter.js`)
- "The model has automatic exclusions — Coors Field, small starter samples, extreme juice, line
  moves against the pick." (true, see README's Verdict system section)
- "Our fantasy rankings use VORP and statistically-detected tier breaks, not fixed cutoffs."
  (true, `lib/nfl-fantasy/vorp.js`, `tiers.js`)
- "We backtest against multi-season historical data before anything ships." (true — 2022–2025
  Retrosheet logs for MLB; historical seasons for fantasy)
- "Public, auditable record." (true, as long as `/record` stays live and accurate)

## Claims that need a hedge or should be avoided

- **"We beat Vegas"** — only ever pair this with the live edge % / record, and frame it as "our
  model's implied probability vs. the market's" — never imply a guarantee of future results.
- **Any specific future win-rate promise** — the model is probabilistic; past performance language
  should follow standard "not indicative of future results" practice common in this category.
- **"Guaranteed," "lock," "can't lose"** — never use these; see `messaging-pillars.md`.
- **Fantasy projection accuracy as a hard percentage** — the backtest system exists and validates
  against real seasons, but treat exact accuracy figures as internal until a specific number has
  been reviewed and approved for external use.

## Compliance note

This is a sports-betting-adjacent product. Any paid ad copy, especially anything implying
"beat the odds," "guaranteed edge," or specific ROI, should be reviewed against the ad platform's
gambling-content policies and applicable state/local regulations before publishing — this file is
a content-accuracy guardrail, not legal advice.
