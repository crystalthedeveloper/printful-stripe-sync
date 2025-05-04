/**
 * sync-printful-products.js
 *
 * Purpose: Sync Printful products and their variants into Stripe.
 * Ensures:
 * - No duplicate products or prices.
 * - Stripe products/metadata stay in sync with Printful.
 * - Each price is tagged with sync_variant_id for fulfillment.
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
const STRIPE_KEY =
  MODE === "live"
    ? process.env.STRIPE_SECRET_KEY
    : process.env.STRIPE_SECRET_TEST;

if (!STRIPE_KEY) throw new Error(`❌ Missing Stripe key for mode: ${MODE}`);
if (!process.env.PRINTFUL_API_KEY)
  throw new Error("❌ Missing PRINTFUL_API_KEY");

const stripe = new Stripe(STRIPE_KEY, { apiVersion: "2023-10-16" });

async function run() {
  console.log(`🚀 Starting Printful → Stripe sync in ${MODE.toUpperCase()} mode`);
  const products = await getPrintfulProducts();

  let added = 0;
  let updated = 0;
  let skipped = 0;
  let errored = 0;

  for (const { title, metadata, price } of products) {
    try {
      if (!metadata?.sync_variant_id || !price) {
        console.warn(`⚠️ Skipping incomplete product: ${title}`);
        skipped++;
        continue;
      }

      const { id, created } = await getOrCreateProduct(
        stripe,
        title,
        metadata,
        DRY_RUN
      );

      await ensurePriceExists(
        stripe,
        id,
        price,
        metadata.sync_variant_id, // ✅ Used by webhook and metadata
        metadata.image_url,
        DRY_RUN
      );

      created ? added++ : updated++;
      console.log(`${created ? "➕ Created" : "🔁 Updated"}: ${title}`);
    } catch (err) {
      console.error(`❌ Error for ${title}: ${err.message}`);
      errored++;
    }
  }

  console.log(
    `✅ SYNC COMPLETE (${MODE.toUpperCase()}) → Added: ${added}, Updated: ${updated}, Skipped: ${skipped}, Errors: ${errored}`
  );
}

run();