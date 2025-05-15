/**
 * sync-printful-products.js
 *
 * Purpose: Sync Printful products and their variants into Stripe.
 * - Avoids duplicates by matching sync_variant_id.
 * - Ensures metadata is clean (no legacy keys).
 * - Creates or updates prices with proper metadata.
 */

import dotenv from "dotenv";
import Stripe from "stripe";
import {
  getPrintfulProducts,
  getOrCreateProduct,
  ensurePriceExists,
} from "./utils.js";

dotenv.config();

const DRY_RUN = process.env.DRY_RUN === "true";
const MODE = process.argv[2] || process.env.MODE || "test";
const STRIPE_KEY = MODE === "live"
  ? process.env.STRIPE_SECRET_KEY
  : process.env.STRIPE_SECRET_TEST;

if (!STRIPE_KEY) throw new Error(`❌ Missing Stripe key for mode: ${MODE.toUpperCase()}`);
if (!process.env.PRINTFUL_API_KEY) throw new Error("❌ Missing PRINTFUL_API_KEY");

const stripe = new Stripe(STRIPE_KEY, { apiVersion: "2023-10-16" });

async function run() {
  console.log(`🚀 Syncing Printful → Stripe (${MODE.toUpperCase()} mode)`);

  const products = await getPrintfulProducts();
  let added = 0, updated = 0, skipped = 0, errored = 0;

  for (const { title, metadata, price } of products) {
    try {
      const {
        sync_variant_id,
        sku,
        printful_variant_name,
        printful_product_name,
        size,
        color,
        image_url
      } = metadata;

      if (!sync_variant_id || !sku || !price) {
        console.warn(`⚠️ Skipping incomplete product: ${title}`);
        skipped++;
        continue;
      }

      // ✅ Compose product name: required by lookup-stripe-price.ts
      const composedName = `${printful_product_name} - ${printful_variant_name}`.trim();

      // ✅ Clean metadata — add stripe_product_name for debugging & matching
      const stripeMetadata = {
        sync_variant_id,
        sku,
        printful_variant_name,
        printful_product_name,
        stripe_product_name: composedName, // 👈 added here
        size,
        color,
        image_url,
        mode: MODE
      };

      const { id, created } = await getOrCreateProduct(stripe, composedName, stripeMetadata, DRY_RUN);

      await ensurePriceExists(stripe, id, price, sync_variant_id, image_url, DRY_RUN);

      created ? added++ : updated++;
      console.log(`${created ? "➕ Created" : "🔁 Updated"}: ${composedName}`);
    } catch (err) {
      console.error(`❌ Error syncing ${title}: ${err.message}`);
      errored++;
    }
  }

  console.log(
    `✅ SYNC COMPLETE (${MODE.toUpperCase()}) → Added: ${added}, Updated: ${updated}, Skipped: ${skipped}, Errors: ${errored}`
  );
}

run().catch(err => console.error("❌ Sync process failed:", err.message));