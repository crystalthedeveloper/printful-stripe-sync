/**
 * update-stripe-products.js
 *
 * Purpose: Refresh all Stripe product metadata, name, and image based on Printful data.
 * Use Case: Run daily to stay in sync with Printful even if products weren’t recently added.
 * Mode: "test" or "live" passed via CLI or env.
 */

import dotenv from "dotenv";
import Stripe from "stripe";
import { getAllStripeProducts, getPrintfulVariantDetails } from "./utils.js";
dotenv.config();

const DRY_RUN = process.env.DRY_RUN === "true";
const MODE = process.argv[2] || process.env.MODE || "test";
const STRIPE_KEY = MODE === "live" ? process.env.STRIPE_SECRET_KEY : process.env.STRIPE_SECRET_TEST;

if (!STRIPE_KEY || !process.env.PRINTFUL_API_KEY) {
  throw new Error("❌ Missing Stripe or Printful credentials.");
}

const stripe = new Stripe(STRIPE_KEY, { apiVersion: "2023-10-16" });

async function run() {
  const products = await getAllStripeProducts(stripe);

  let updated = 0, skipped = 0, errors = 0;

  for (const p of products) {
    const variantId = p.metadata?.printful_variant_id;
    const syncProductId = p.metadata?.printful_sync_product_id;

    if (!variantId || !syncProductId) {
      skipped++;
      continue;
    }

    try {
      const { title, metadata } = await getPrintfulVariantDetails(syncProductId, variantId);
      if (!DRY_RUN) {
        await stripe.products.update(p.id, { name: title, metadata });
      }
      console.log(`🔄 Updated metadata: ${title}`);
      updated++;
    } catch (err) {
      console.error(`❌ Failed to update ${p.id}: ${err.message}`);
      errors++;
    }
  }

  console.log(`✅ UPDATE COMPLETE (${MODE.toUpperCase()}) → Updated: ${updated}, Skipped: ${skipped}, Errors: ${errors}`);
}

run();