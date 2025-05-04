/**
 * update-stripe-products.js
 *
 * Purpose: Refresh all existing Stripe products with latest metadata from Printful.
 * - Only updates products that already exist.
 * - Ensures name and metadata match the latest Printful info.
 */

import dotenv from "dotenv";
import Stripe from "stripe";
import { getAllStripeProducts, getPrintfulVariantDetails } from "./utils.js";

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
  console.log(`🔄 Updating Stripe product metadata (${MODE.toUpperCase()})`);
  const products = await getAllStripeProducts(stripe);

  let updated = 0,
    skipped = 0,
    errored = 0;

  for (const product of products) {
    const variantId = product.metadata?.sync_variant_id; // ✅ updated metadata key
    const syncProductId = product.metadata?.printful_sync_product_id;

    if (!variantId || !syncProductId) {
      skipped++;
      continue;
    }

    try {
      const { title, metadata } = await getPrintfulVariantDetails(
        syncProductId,
        variantId
      );

      const needsUpdate =
        product.name !== title ||
        JSON.stringify(product.metadata) !== JSON.stringify(metadata);

      if (needsUpdate && !DRY_RUN) {
        await stripe.products.update(product.id, {
          name: title,
          metadata,
          active: true,
        });
        console.log(`🔁 Updated: ${title}`);
        updated++;
      } else {
        skipped++;
      }
    } catch (err) {
      console.error(`❌ Error updating ${product.name}: ${err.message}`);
      errored++;
    }
  }

  console.log(
    `✅ UPDATE COMPLETE (${MODE.toUpperCase()}) → Updated: ${updated}, Skipped: ${skipped}, Errors: ${errored}`
  );
}

run();