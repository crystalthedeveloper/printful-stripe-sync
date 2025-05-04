/**
 * update-stripe-metadata.js
 *
 * Cleans and updates Stripe product metadata:
 * - Overwrites legacy keys: `printful_variant_id`, `printful_sync_product_id`
 * - Adds `sku` from sync_variant_id if missing
 * - Leaves all other keys intact
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
  console.log(`🚨 Overwriting outdated metadata in ${MODE.toUpperCase()} mode`);

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
    const original = { ...product.metadata };
    const metadata = { ...original };

    let changed = false;

    // Rename legacy keys instead of deleting
    if ("printful_variant_id" in metadata) {
      metadata.legacy_printful_variant_id = metadata.printful_variant_id;
      delete metadata.printful_variant_id;
      changed = true;
    }

    if ("printful_sync_product_id" in metadata) {
      metadata.legacy_printful_sync_product_id = metadata.printful_sync_product_id;
      delete metadata.printful_sync_product_id;
      changed = true;
    }

    // Add fallback SKU if missing
    if (!metadata.sku && (original.sync_variant_id || original.printful_variant_id)) {
      metadata.sku = original.sku || original.sync_variant_id || original.printful_variant_id;
      changed = true;
    }

    if (!changed) continue;

    try {
      await stripe.products.update(product.id, { metadata });
      console.log(`✅ Updated: ${product.name} (${product.id})`);
      updated++;
    } catch (err) {
      console.error(`❌ Failed to update ${product.name}: ${err.message}`);
    }
  }

  console.log(`🎉 Done. ${updated} product(s) updated in ${MODE.toUpperCase()} mode.`);
}

run().catch((err) => {
  console.error("❌ Script failed:", err.message);
});