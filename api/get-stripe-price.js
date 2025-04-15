// /api/get-stripe-price.js

import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  const { price_id } = req.query;

  if (!price_id) {
    return res.status(400).json({ error: "Missing price_id" });
  }

  try {
    const price = await stripe.prices.retrieve(price_id);
    if (!price || price.deleted) {
      return res.status(404).json({ error: "Stripe price not found" });
    }

    res.status(200).json({
      unit_amount: price.unit_amount,
      currency: price.currency
    });
  } catch (err) {
    console.error("❌ Stripe error:", err.message);
    res.status(500).json({ error: err.message });
  }
}