/**
 * remove-printful-unused-fields.js
 *
 * Removes unused metadata keys (`printful_variant_id` and `printful_sync_product_id`)
 * from all Stripe products.
 */

import dotenv from "dotenv";
import Stripe from "stripe";

dotenv.config();

const MODE = process.argv[2] || process.env.MODE || "test";
const STRIPE_KEY = MODE === "live"
  ? process.env.STRIPE_SECRET_KEY
  : process.env.STRIPE_SECRET_TEST;

if (!STRIPE_KEY) throw new Error(`❌ Missing Stripe key for mode: ${MODE.toUpperCase()}`);

const stripe = new Stripe(STRIPE_KEY, { apiVersion: "2023-10-16" });

async function run() {
  console.log(`🚨 Cleaning up unused Printful metadata in ${MODE.toUpperCase()} mode`);

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

  let updated = 0;
  for (const product of products) {
    const originalMetadata = { ...product.metadata };
    const metadata = { ...originalMetadata };

    let removed = false;

    if ("printful_variant_id" in metadata) {
      delete metadata.printful_variant_id;
      removed = true;
    }

    if ("printful_sync_product_id" in metadata) {
      delete metadata.printful_sync_product_id;
      removed = true;
    }

    if (removed) {
      try {
        await stripe.products.update(product.id, { metadata });
        console.log(`✅ Cleaned ${product.name} (${product.id})`);
        updated++;
      } catch (err) {
        console.error(`❌ Failed to update ${product.name}: ${err.message}`);
      }
    }
  }

  console.log(`🎉 Done. ${updated} product(s) cleaned in ${MODE.toUpperCase()} mode.`);
}

run().catch((err) => {
  console.error("❌ Script failed:", err.message);
});