# tot-app

A production MLB betting picks platform featuring a statistical prediction model, AI-generated analysis, Stripe subscriptions, and fully automated daily operations.

**Live:** thisthatpicks.com


---

## Features

- **Daily picks** — statistical model generates MLB picks each morning with confidence scores and edge ratings
- **AI breakdowns** — Claude writes a narrative analysis for each pick covering matchup context, pitching, and bullpen
- **Stripe paywall** — full subscription flow with checkout, webhooks, and account management
- **Access codes** — invite friends and family with code-based free access
- **Twitter/X bot** — top 3 picks posted automatically at 10:15 AM CT daily
- **Email delivery** — daily pick digest sent to free subscribers via Resend
- **Record tracking** — W-L record with monthly calendar view and model performance analytics
- **Admin panel** — manage picks, post tweets manually, view analytics, and monitor model accuracy

---

## Tech Stack

| Layer | Technology |
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

Picks are generated once daily by a Vercel cron job at 3 PM UTC (10 AM CT):

1. Fetches live MLB odds and starting pitcher data
2. Runs the statistical model to score each game
3. Calls Claude to generate a breakdown for qualifying picks
4. Writes results to the `picks_cache` table in Supabase
5. Sends the daily email digest and posts to Twitter

The `/api/picks` route serves from cache on every request and overlays live scores in real time.

### Subscription flow

Stripe handles all billing. On `checkout.session.completed`, the webhook writes to the `subscriptions` table in Supabase keyed by `user_id`. Access codes bypass the paywall entirely and are validated server-side at redemption.

---

## Prediction Model

The model produces a win probability for each team and compares it against the vig-removed market implied probability to find an edge.

### Probability factors

Seven independent signals are combined into a single home-win probability. No single factor dominates — the largest weight is 22%.

| Factor | Weight | Source |
|---|---|---|
| Lineup quality vs pitcher handedness | 22% | Team OPS splits + Baseball Savant wOBA |
| Starting pitcher quality | 20% | xFIP > K-BB% > ERA; hard-hit% when available |
| Bullpen quality | 20% | 14-day rolling ERA/WHIP/K9; fatigue penalty applied |
| Season standings | 15% | Win percentage |
| Recent form | 13% | 10-game OPS (70%) blended with 7-day OPS (30%) |
| Park factor | 10% | Per-ballpark run environment and HR skew |
| Elo rating | 5% | Updated from historical game logs; capped to prevent overriding live data |

**Pitcher scoring** uses xFIP over ERA where available (xFIP strips out park effects and BABIP luck). All stats are stabilized by sample size — a starter with 10 IP gets regressed heavily toward the league average. Recent starts (last 5) are blended in at 60% weight when a meaningful sample exists.

**Bullpen scoring** weights rolling 14-day ERA most heavily. A fatigue flag triggers when a bullpen's 3-day ERA exceeds its 14-day baseline by 1.5+ points, indicating key relievers are overworked.

### Edge calculation

```
Market edge = model win probability − vig-removed implied probability
True edge   = raw edge − variance penalty − sample penalty − lineup penalty
```

Edge is then shrunk by a factor based on variance (`LOW` → 78%, `MED` → 62%, `HIGH` → 45%) to reflect that liquid MLB markets price in most public information.

### Verdict system

Every pick earns one of four verdicts:

| Verdict | Meaning |
|---|---|
| **CLEAN** | Passes every AND-gate condition — full confidence |
| **BET** | Minor failures only (e.g. lineup not yet posted) — still actionable |
| **PASS** | Insufficient edge or confidence — no bet |
| **TRAP** | Negative edge — model favors the other side |

The AND-gate is strict. Automatic exclusions include: Coors Field (park model cannot compensate), pick-side SP with fewer than 12 IP (ERA is noise at that sample), juice above −300, and closing line movement that contradicts the model.

A **HALF SIZE** flag is applied to CLEAN picks where the pick-side bullpen ERA exceeds 5.00 or recent bullpen fatigue is detected — the pick is still valid but late-game reliability is reduced.

### Confidence score

Each pick receives a confidence score from 0–10 built from additive bonuses and deductions (low variance, meaningful SP sample, bullpen strength, lineup advantage, closing line confirmation, etc.). A minimum of 6.5/10 is required for any actionable verdict.

---

## Project Structure

```
app/
├── page.js              # Homepage (merged landing for logged-out users)
├── app/page.js          # Main picks view
├── admin/page.js        # Admin dashboard
├── api/
│   ├── picks/           # Picks serving route
│   ├── cron/picks/      # Daily cron job
│   ├── stripe/webhook/  # Stripe event handler
│   └── redeem-code/     # Access code redemption
lib/                     # Shared utilities and Supabase client
data/                    # Static data files (team mappings, historical logs)
```

---

## Local Development

```bash
npm install
npm run dev
```

Pull environment variables from Vercel:

```bash
vercel env pull
```

### Required environment variables

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (server-side only) |
| `STRIPE_SECRET_KEY` | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe publishable key |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `RESEND_API_KEY` | Resend API key |
| `TWITTER_*` | Twitter API v2 credentials |
| `NEXT_PUBLIC_APP_URL` | Public URL (e.g. `https://tot-app.vercel.app`) |

---

## Deployment

Deployed on Vercel. The cron job is configured in `vercel.json` and runs daily at 3 PM UTC. All environment variables are managed through the Vercel dashboard.
