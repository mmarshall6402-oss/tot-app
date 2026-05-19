import Stripe from "stripe";

export const getStripe = () => new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

export const PLANS = {
  get monthly() { return process.env.STRIPE_MONTHLY_PRICE_ID; },
  get annual()  { return process.env.STRIPE_ANNUAL_PRICE_ID; },
};
