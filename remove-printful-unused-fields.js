/**
 * update-stripe-metadata.js
 *
 * Cleans up metadata by:
 * - Removing `printful_variant_id` and `printful_sync_product_id`
 * - Moving their values to `legacy_` versions (if not already there)
 * - Keeps only `sync_variant_id` and `sku`
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
  console.log(`🧹 Final cleanup of duplicated metadata in ${MODE.toUpperCase()} mode`);

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

    // Move old values to legacy fields if not already moved
    if ("printful_variant_id" in metadata && !metadata.legacy_printful_variant_id) {
      metadata.legacy_printful_variant_id = metadata.printful_variant_id;
      changed = true;
    }

    if ("printful_sync_product_id" in metadata && !metadata.legacy_printful_sync_product_id) {
      metadata.legacy_printful_sync_product_id = metadata.printful_sync_product_id;
      changed = true;
    }

    // Remove all redundant keys
    if ("printful_variant_id" in metadata) {
      delete metadata.printful_variant_id;
      changed = true;
    }

    if ("printful_sync_product_id" in metadata) {
      delete metadata.printful_sync_product_id;
      changed = true;
    }

    // Ensure SKU is set
    if (!metadata.sku && metadata.sync_variant_id) {
      metadata.sku = metadata.sync_variant_id;
      changed = true;
    }

    if (!changed) continue;

    try {
      await stripe.products.update(product.id, { metadata });
      console.log(`✅ Cleaned ${product.name} (${product.id})`);
      updated++;
    } catch (err) {
      console.error(`❌ Failed to update ${product.name}: ${err.message}`);
    }
  }

  console.log(`🎉 Done. ${updated} product(s) cleaned in ${MODE.toUpperCase()} mode.`);
}

run().catch((err) => {
  console.error("❌ Script failed:", err.message);
});