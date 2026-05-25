# tot-app

MLB betting picks app with AI-generated breakdowns, Stripe paywall, and daily automated pick posting.

Live at [tot-app.vercel.app](https://tot-app.vercel.app)

## What it does

- Generates daily MLB picks using a statistical model + Claude AI breakdown
- Paywalled with Stripe subscriptions; access codes available for friends/family
- Posts top 3 picks to Twitter/X daily at 10:15 AM CT
- Sends daily pick emails to free subscribers
- Tracks record with a monthly W-L calendar

## Stack

- **Framework:** Next.js (App Router)
- **Auth + DB:** Supabase
- **Payments:** Stripe
- **AI:** Anthropic Claude (pick breakdowns)
- **Email:** Resend
- **Twitter:** twitter-api-v2
- **Deployment:** Vercel (cron at 3 PM UTC daily)

## Key routes

| Route | Description |
|-------|-------------|
| `/` | Homepage / picks (merged landing for logged-out users) |
| `/app` | Main picks view |
| `/admin` | Admin tools — picks, tweets, analytics |
| `/api/picks` | Serves picks from cache with live score overlay |
| `/api/cron/picks` | Daily cron — runs model, calls Claude, writes cache |
| `/api/stripe/webhook` | Stripe event handler |
| `/api/redeem-code` | Access code redemption |

## Local dev

```bash
npm install
npm run dev
```

Requires `.env.local` with keys for Supabase, Stripe, Anthropic, Resend, and Twitter.

## Environment variables

See Vercel project settings for the full list. Required vars include:
- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`
- `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- `ANTHROPIC_API_KEY`
- `RESEND_API_KEY`
- `TWITTER_*` credentials
- `NEXT_PUBLIC_APP_URL`
