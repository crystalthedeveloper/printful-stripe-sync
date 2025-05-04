/**
 * sync-printful-products.js
 *
 * Purpose: Sync Printful products/variants to Stripe (create if not exists, update if changed).
 * Mode: Pass "test" or "live" via CLI args or environment variable.
 *
 * Logic:
 * - Loops through Printful products + variants
 * - Checks Stripe for existing product by `printful_variant_id`
 * - Updates name, metadata, price if found
 * - Creates new product + price if not found
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

if (!STRIPE_KEY) {
  throw new Error(`❌ Missing Stripe key for mode: ${MODE}`);
}
if (!process.env.PRINTFUL_API_KEY) {
  throw new Error("❌ Missing PRINTFUL_API_KEY");
}

const stripe = new Stripe(STRIPE_KEY, {
  apiVersion: "2023-10-16",
});

async function run() {
  console.log(`🚀 Starting Printful → Stripe sync in ${MODE.toUpperCase()} mode`);
  const products = await getPrintfulProducts();

  let added = 0,
    updated = 0,
    errored = 0;

  for (const p of products) {
    try {
      const { id, created } = await getOrCreateProduct(
        stripe,
        p.title,
        p.metadata,
        DRY_RUN
      );

      await ensurePriceExists(
        stripe,
        id,
        p.price,
        p.metadata.printful_variant_id,
        p.metadata.image_url,
        DRY_RUN
      );

      created ? added++ : updated++;
      console.log(`${created ? "➕ Created" : "🔁 Updated"}: ${p.title}`);
    } catch (err) {
      console.error(`❌ Error for ${p.title}: ${err.message}`);
      errored++;
    }
  }

  console.log(
    `✅ SYNC COMPLETE (${MODE.toUpperCase()}) → Added: ${added}, Updated: ${updated}, Errors: ${errored}`
  );
}

run();