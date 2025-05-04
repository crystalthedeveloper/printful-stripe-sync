/**
 * sync-printful-products.js
 *
 * Purpose: Sync Printful products and their variants into Stripe.
 * - No duplicates are created.
 * - Product metadata includes full Printful info.
 * - Prices are created or updated with proper metadata.
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

if (!STRIPE_KEY) throw new Error(`❌ Missing Stripe key for mode: ${MODE}`);
if (!process.env.PRINTFUL_API_KEY) throw new Error("❌ Missing PRINTFUL_API_KEY");

const stripe = new Stripe(STRIPE_KEY, { apiVersion: "2023-10-16" });

async function run() {
  console.log(`🚀 Starting Printful → Stripe sync (${MODE.toUpperCase()} mode)`);
  const products = await getPrintfulProducts();

  let added = 0;
  let updated = 0;
  let skipped = 0;
  let errored = 0;

  for (const { title, metadata, price } of products) {
    try {
      const {
        sync_variant_id,
        sku,
        printful_variant_name,
        printful_product_name,
        size,
        color,
        image_url,
      } = metadata;

      if (!sync_variant_id || !sku || !price) {
        console.warn(`⚠️ Skipping incomplete product: ${title}`);
        skipped++;
        continue;
      }

      // Ensure all metadata is passed cleanly
      const stripeMetadata = {
        sync_variant_id: String(sync_variant_id),
        sku,
        printful_variant_name,
        printful_product_name,
        size,
        color,
        image_url,
      };

      const { id, created } = await getOrCreateProduct(stripe, title, stripeMetadata, DRY_RUN);

      await ensurePriceExists(
        stripe,
        id,
        price,
        sync_variant_id,
        image_url,
        DRY_RUN
      );

      created ? added++ : updated++;
      console.log(`${created ? "➕ Created" : "🔁 Updated"}: ${title}`);
    } catch (err) {
      console.error(`❌ Error syncing ${title}: ${err.message}`);
      errored++;
    }
  }

  console.log(
    `✅ SYNC COMPLETE (${MODE.toUpperCase()}) → Added: ${added}, Updated: ${updated}, Skipped: ${skipped}, Errors: ${errored}`
  );
}

run().catch((err) => {
  console.error("❌ Sync process failed:", err.message);
});