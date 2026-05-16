import Stripe from "stripe";

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export const PRICES = {
  monthly: process.env.STRIPE_MONTHLY_PRICE_ID,
  annual:  process.env.STRIPE_ANNUAL_PRICE_ID,
};
