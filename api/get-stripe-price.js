// /api/get-stripe-price.js

import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  const { price_id } = req.query;

  try {
    const price = await stripe.prices.retrieve(price_id);
    res.status(200).json({
      unit_amount: price.unit_amount,
      currency: price.currency,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}