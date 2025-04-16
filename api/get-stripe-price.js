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

    // Stripe returns `deleted: true` for removed prices
    if (!price || price.deleted) {
      console.warn("⚠️ Stripe price not found or deleted:", price_id);
      return res.status(404).json({ error: "Stripe price not found" });
    }

    // Log the full response (useful for debugging currencies, etc.)
    console.log("✅ Stripe price retrieved:", {
      price_id,
      unit_amount: price.unit_amount,
      currency: price.currency,
      live_mode: price.livemode,
    });

    return res.status(200).json({
      unit_amount: price.unit_amount,
      currency: price.currency,
    });

  } catch (err) {
    console.error("❌ Stripe error:", {
      message: err.message,
      type: err.type,
      code: err.code,
      doc_url: err.doc_url,
    });

    return res.status(500).json({
      error: err.message || "Unexpected Stripe error",
    });
  }
}