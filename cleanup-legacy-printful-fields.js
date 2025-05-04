/**
 * cleanup-stripe-prices.js
 *
 * Deactivates (archives) all but one price per Stripe product.
 * Stripe does not support hard deletion of prices via API.
 */

import dotenv from "dotenv";
import Stripe from "stripe";

dotenv.config();

const MODE = process.argv[2] || process.env.MODE || "test";
const STRIPE_KEY =
  MODE === "live" ? process.env.STRIPE_SECRET_KEY : process.env.STRIPE_SECRET_TEST;

if (!STRIPE_KEY) throw new Error(`❌ Missing Stripe key for mode: ${MODE.toUpperCase()}`);

const stripe = new Stripe(STRIPE_KEY, { apiVersion: "2023-10-16" });

async function run() {
  console.log(`🧹 Starting aggressive price cleanup in ${MODE.toUpperCase()} mode...`);

  const products = [];
  let hasMore = true;
  let starting_after;

  while (hasMore) {
    const res = await stripe.products.list({ limit: 100, starting_after });
    products.push(...res.data);
    hasMore = res.has_more;
    if (res.data.length > 0) {
      starting_after = res.data[res.data.length - 1].id;
    }
  }

  let cleaned = 0;

  for (const product of products) {
    const prices = await stripe.prices.list({ product: product.id, limit: 100 });

    if (prices.data.length <= 1) continue;

    const productSyncId = product.metadata?.sync_variant_id;
    const keeper = prices.data.find(p => p.metadata?.sync_variant_id === productSyncId) || prices.data[0];

    for (const price of prices.data) {
      if (price.id !== keeper.id && price.active) {
        try {
          await stripe.prices.update(price.id, { active: false });
          console.log(`🗑️ Archived price: ${price.id} (${product.name})`);
        } catch (err) {
          console.error(`❌ Failed to archive price ${price.id}: ${err.message}`);
        }
      }
    }

    cleaned++;
  }

  console.log(`✅ Cleanup done: ${cleaned} product(s) processed in ${MODE.toUpperCase()} mode.`);
}

run().catch(err => {
  console.error("❌ Fatal error during cleanup:", err.message);
});