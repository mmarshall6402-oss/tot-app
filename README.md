<div align="center">

# T|T

**MLB betting picks powered by a statistical model + AI analysis**

[![Live](https://img.shields.io/badge/live-tot--app.vercel.app-00FF87?style=flat-square&logo=vercel&logoColor=black)](https://tot-app.vercel.app)
[![Next.js](https://img.shields.io/badge/Next.js-App_Router-black?style=flat-square&logo=next.js)](https://nextjs.org)
[![Supabase](https://img.shields.io/badge/Supabase-Database_%26_Auth-3ECF8E?style=flat-square&logo=supabase&logoColor=white)](https://supabase.com)
[![Stripe](https://img.shields.io/badge/Stripe-Payments-635BFF?style=flat-square&logo=stripe&logoColor=white)](https://stripe.com)

</div>

---

## What it does

Every morning the model wakes up, pulls live MLB odds and pitcher data, finds the sharpest edges, and publishes a daily card — complete with AI-written breakdowns, confidence scores, and a public W-L record. Paid subscribers get full access; friends and family get in with an invite code.

---

## Features

| | |
|---|---|
| **Daily picks** | Statistical model runs each morning, scores every game, flags edges |
| **AI breakdowns** | Claude writes a narrative for each pick — matchup context, pitching, bullpen |
| **Record tracking** | Running W-L with monthly calendar and model accuracy analytics |
| **Stripe paywall** | Full subscription flow — checkout, webhooks, account management |
| **Access codes** | Invite-only free access validated server-side |
| **X / Twitter bot** | Top 3 picks auto-posted at 10:15 AM CT |
| **Email digest** | Daily pick card sent to free subscribers via Resend |
| **Admin panel** | Manage picks, post manually, view analytics, monitor model |

---

## Tech stack

| Layer | Tech |
|---|---|
| Framework | Next.js (App Router) |
| Database & Auth | Supabase |
| Payments | Stripe |
| AI | Anthropic Claude |
| Email | Resend |
| Social | Twitter API v2 |
| Deployment | Vercel |

---

## Architecture

### Pick pipeline

A Vercel cron fires daily at 3 PM UTC (10 AM CT):

1. Fetch live MLB odds + starting pitcher data
2. Run the statistical model — score every game
3. Call Claude to generate breakdowns for qualifying picks
4. Write to `picks_cache` in Supabase
5. Send email digest + post to X

`/api/picks` serves from cache and overlays live scores on every request.

### Subscription flow

Stripe handles all billing. On `checkout.session.completed` the webhook writes to the `subscriptions` table keyed by `user_id`. Access codes skip the paywall entirely and are redeemed server-side.

---

## Prediction model

The model estimates a win probability for each team and measures it against the vig-removed market implied probability to surface an edge.

### Factors

Seven independent signals combine into a single home-win probability. No single signal dominates — the largest weight is 22%.

| Factor | Weight | Notes |
|---|---|---|
| Lineup quality vs pitcher handedness | **22%** | Team OPS splits + Baseball Savant wOBA |
| Starting pitcher quality | **20%** | xFIP › K-BB% › ERA; hard-hit% when available |
| Bullpen quality | **20%** | 14-day rolling ERA/WHIP/K9; fatigue penalty |
| Season standings | **15%** | Win percentage |
| Recent form | **13%** | 10-game OPS (70%) blended with 7-day OPS (30%) |
| Park factor | **10%** | Per-ballpark run environment and HR skew |
| Elo rating | **5%** | Historical logs; capped to avoid overriding live data |

**Pitcher scoring** prefers xFIP (strips park effects and BABIP luck) over ERA. Low-sample starters are regressed toward league average. Recent starts (last 5) blend in at 60% weight.

**Bullpen scoring** weights rolling 14-day ERA most heavily. A fatigue flag fires when a bullpen's 3-day ERA exceeds its 14-day baseline by 1.5+ runs.

### Edge formula

```
market edge = model probability − vig-removed implied probability
true edge   = raw edge − variance penalty − sample penalty − lineup penalty
```

Edge is then shrunk based on variance confidence: `LOW → 78%`, `MED → 62%`, `HIGH → 45%`.

### Verdicts

| Verdict | Meaning |
|---|---|
| `CLEAN` | Passes every AND-gate condition — full confidence |
| `BET` | Minor failures only (e.g. lineup not yet posted) — still actionable |
| `PASS` | Insufficient edge or confidence |
| `TRAP` | Negative edge — model favors the other side |

**Auto-exclusions:** Coors Field, pick-side SP under 12 IP, juice above −300, closing line movement against the model.

**HALF SIZE** flag applies to CLEAN picks where the pick-side bullpen ERA exceeds 5.00 or fatigue is detected.

**Minimum confidence:** 6.5 / 10 required for any actionable verdict.

---

## Project structure

```
app/
├── page.js           # Main picks view (landing for logged-out users)
├── admin/page.js     # Admin dashboard
├── api/
│   ├── picks/        # Picks serving route
│   ├── cron/picks/   # Daily cron job
│   ├── stripe/       # Stripe webhook handler
│   └── redeem-code/  # Access code redemption
lib/                  # Shared utilities and Supabase client
data/                 # Team mappings, historical logs
```

---

## Local development

```bash
npm install
npm run dev
```

Pull env vars from Vercel:

```bash
vercel env pull
```

### Environment variables

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (server-side only) |
| `STRIPE_SECRET_KEY` | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe publishable key |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `RESEND_API_KEY` | Resend API key |
| `TWITTER_*` | Twitter API v2 credentials |
| `NEXT_PUBLIC_APP_URL` | Public URL (e.g. `https://tot-app.vercel.app`) |

---

## Deployment

Deployed on Vercel. Cron is configured in `vercel.json` and runs daily at 3 PM UTC. All env vars live in the Vercel dashboard.
