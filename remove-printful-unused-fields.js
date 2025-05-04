/**
 * remove-printful-unused-fields.js
 *
 * Removes unused metadata keys (`printful_variant_id` and `printful_sync_product_id`)
 * from all Stripe products.
 *
 * Usage:
 *    node remove-printful-unused-fields.js test
 *    node remove-printful-unused-fields.js live
 */

import dotenv from "dotenv";
import Stripe from "stripe";

dotenv.config();

const MODE = process.argv[2] || process.env.MODE || "test";
const STRIPE_KEY = MODE === "live" ? process.env.STRIPE_SECRET_KEY : process.env.STRIPE_SECRET_TEST;

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

  if (products.length === 0) {
    console.log("⚠️ No products found.");
    return;
  }

  let updated = 0;
  for (const product of products) {
    const metadata = { ...product.metadata };
    const hadVariant = "printful_variant_id" in metadata;
    const hadSyncProduct = "printful_sync_product_id" in metadata;

    if (hadVariant || hadSyncProduct) {
      delete metadata.printful_variant_id;
      delete metadata.printful_sync_product_id;

      await stripe.products.update(product.id, { metadata });
      console.log(`✅ Cleaned: ${product.name} (${product.id})`);
      updated++;
    }
  }

  console.log(`🎉 Done. ${updated} product(s) cleaned in ${MODE.toUpperCase()} mode.`);
}

run().catch((err) => {
  console.error("❌ Error:", err.message);
});