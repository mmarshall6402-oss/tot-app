import Stripe from "stripe";

export const getStripe = () => new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

export const PLANS = {
  get monthly() { return process.env.STRIPE_MONTHLY_PRICE_ID; },
  // "Season" is the Sept-Jan season pass — same underlying Stripe Price as the
  // old "annual" plan (rename the env var only if you also update the Price
  // object's amount/interval in the Stripe dashboard; this alias just lets the
  // checkout route apply a season-appropriate cancel_at instead of billing
  // year-round).
  get season()   { return process.env.STRIPE_ANNUAL_PRICE_ID; },
  get annual()   { return process.env.STRIPE_ANNUAL_PRICE_ID; },
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
