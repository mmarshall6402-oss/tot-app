import Stripe from "stripe";

let _stripe;
export const getStripe = () => {
  if (!_stripe) _stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  return _stripe;
};

export const PRICES = {
  monthly: process.env.STRIPE_MONTHLY_PRICE_ID,
  annual:  process.env.STRIPE_ANNUAL_PRICE_ID,
};
