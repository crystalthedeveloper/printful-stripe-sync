/**
 * cleanup-legacy-printful-fields.js
 *
 * Permanently deletes legacy Printful metadata fields from Stripe products.
 * - Removes: legacy_printful_variant_id, legacy_printful_sync_product_id, printful_variant_id
 */

import dotenv from "dotenv";
import Stripe from "stripe";

dotenv.config();

const MODE = process.argv[2] || process.env.MODE || "test";
const STRIPE_KEY =
  MODE === "live" ? process.env.STRIPE_SECRET_KEY : process.env.STRIPE_SECRET_TEST;

if (!STRIPE_KEY) throw new Error(`❌ Missing Stripe key for mode: ${MODE.toUpperCase()}`);

const stripe = new Stripe(STRIPE_KEY, { apiVersion: "2023-10-16" });

const FIELDS_TO_REMOVE = [
  "legacy_printful_variant_id",
  "legacy_printful_sync_product_id",
  "printful_variant_id"
];

async function run() {
  console.log(`🧹 Starting permanent metadata cleanup in ${MODE.toUpperCase()} mode...`);

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
    const original = product.metadata || {};
    const updated = { ...original };

    let removedAny = false;

    for (const field of FIELDS_TO_REMOVE) {
      if (field in updated) {
        delete updated[field];
        removedAny = true;
      }
    }

    if (removedAny) {
      try {
        await stripe.products.update(product.id, { metadata: updated });
        console.log(`✅ Cleaned: ${product.name} (${product.id})`);
        cleaned++;
      } catch (err) {
        console.error(`❌ Failed to clean ${product.name}: ${err.message}`);
      }
    }
  }

  console.log(`🎉 Cleanup complete → ${cleaned} product(s) updated in ${MODE.toUpperCase()} mode.`);
}

run().catch((err) => {
  console.error("❌ Fatal error during cleanup:", err.message);
});