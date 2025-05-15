/**
 * cleanup-stripe-prices.js
 *
 * Deactivates (archives) all but one price per Stripe product.
 * Stripe does not support hard deletion of prices via API.
 */

// clean-broken-mappings.js
import Stripe from "stripe";
import dotenv from "dotenv";

dotenv.config();
const MODE = process.argv[2] || "test";
const STRIPE_KEY = MODE === "live"
  ? process.env.STRIPE_SECRET_KEY
  : process.env.STRIPE_SECRET_TEST;

if (!STRIPE_KEY) throw new Error("Missing Stripe Key");
const stripe = new Stripe(STRIPE_KEY, { apiVersion: "2023-10-16" });

async function run() {
  const prices = await stripe.prices.list({ limit: 100 });
  let deleted = 0;

  for (const price of prices.data) {
    if (!price.metadata?.sync_variant_id) {
      console.log(`🗑️ Deleting orphan price: ${price.id} (no sync_variant_id)`);
      await stripe.prices.update(price.id, { active: false });
      deleted++;
    }
  }

  console.log(`✅ Done. Inactive prices: ${deleted}`);
}

run();
