# tot-app

A production MLB betting picks platform featuring a statistical prediction model, AI-generated analysis, Stripe subscriptions, and fully automated daily operations.

**Live:** [tot-app.vercel.app](https://tot-app.vercel.app)

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
