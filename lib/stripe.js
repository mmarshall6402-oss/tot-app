import Stripe from "stripe";

export const getStripe = () => new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

export const PLANS = {
  get monthly() { return process.env.STRIPE_MONTHLY_PRICE_ID; },
  // Dedicated env var, deliberately NOT the old STRIPE_ANNUAL_PRICE_ID — Stripe
  // Price amounts are immutable, so the $45 season pass needs a brand-new Price
  // object in the dashboard regardless (the old $19.99/year Price stays around
  // untouched for any already-grandfathered annual subscribers referencing it).
  // See assertSeasonPriceWontOverbill below for the interval requirement.
  get season() { return process.env.STRIPE_SEASON_PRICE_ID; },
};

// The season pass should stop billing after the fantasy/NFL season ends, not
// renew silently into the offseason. NFL season runs Sept-Jan, so target the
// first Feb 1 at or after purchase.
export function seasonPassCancelAt(now = new Date()) {
  const year = now.getUTCFullYear();
  const feb1ThisYear = Date.UTC(year, 1, 1) / 1000;
  const target = now.getTime() / 1000 < feb1ThisYear ? feb1ThisYear : Date.UTC(year + 1, 1, 1) / 1000;
  return Math.floor(target);
}

const INTERVAL_DAYS = { day: 1, week: 7, month: 30, year: 365 };

// Stripe subscriptions require a recurring Price — a one-time Price can't be
// used with mode: "subscription" at all (Stripe's API rejects it outright),
// which is intentional here: the app's Pro-status sync (app/api/stripe/webhook/route.js)
// is entirely subscription-event-driven, so a one-time "payment"-mode charge
// would never flip the user to Pro or expire them automatically. What Stripe's
// API *won't* catch is a recurring Price billing more than once before
// seasonPassCancelAt() — e.g. a Price configured monthly instead of every 5-6
// months would bill again at the 1-month mark, weeks before cancel_at fires,
// silently charging $45 repeatedly. This checks that the Price's billing
// interval is long enough that only the initial charge happens before
// cancellation, and throws (blocking checkout) rather than risk it.
export async function assertSeasonPriceWontOverbill(stripe, priceId) {
  const price = await stripe.prices.retrieve(priceId);
  if (!price.recurring) {
    throw new Error(`Season Pass price ${priceId} is not recurring — Stripe subscriptions require a recurring Price. Create one with a ~5-6 month interval (or yearly), not a one-time Price.`);
  }
  const { interval, interval_count } = price.recurring;
  const billingIntervalDays = (INTERVAL_DAYS[interval] || 0) * (interval_count || 1);
  const daysUntilCancel = (seasonPassCancelAt() * 1000 - Date.now()) / 86400000;
  if (billingIntervalDays < daysUntilCancel) {
    throw new Error(
      `Season Pass price ${priceId} bills every ~${billingIntervalDays}d, which is shorter than the ~${Math.round(daysUntilCancel)}d ` +
      `until season end — subscribers would be charged more than once. Reconfigure the Price with a longer interval (e.g. every 6 months) before enabling checkout.`
    );
  }
}
