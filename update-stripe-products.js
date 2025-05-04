/**
 * update-stripe-products.js
 *
 * Purpose: Refresh all existing Stripe products with latest metadata from Printful.
 * - Updates only products that include sync_variant_id.
 * - Cleans up legacy fields entirely (not just marked as migrated).
 */

import dotenv from "dotenv";
import Stripe from "stripe";
import { getAllStripeProducts, getPrintfulVariantDetails } from "./utils.js";

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
  console.log(`🧼 Cleaning + updating Stripe metadata (${MODE.toUpperCase()})`);
  const products = await getAllStripeProducts(stripe);

  let updated = 0, skipped = 0, errored = 0;

  for (const product of products) {
    const variantId = product.metadata?.sync_variant_id;

    if (!variantId) {
      console.warn(`⚠️ Skipping: missing sync_variant_id → ${product.name}`);
      skipped++;
      continue;
    }

    try {
      const { title, metadata } = await getPrintfulVariantDetails(variantId);

      // Final metadata with legacy fields removed
      const cleanedMetadata = {
        sync_variant_id: metadata.sync_variant_id,
        sku: metadata.sku,
        printful_variant_name: metadata.printful_variant_name,
        printful_product_name: metadata.printful_product_name,
        size: metadata.size,
        color: metadata.color,
        image_url: metadata.image_url
      };

      // Remove legacy fields from existing metadata if present
      const existing = { ...product.metadata };
      delete existing.printful_variant_id;
      delete existing.legacy_printful_variant_id;
      delete existing.legacy_printful_sync_product_id;

      const needsUpdate =
        product.name !== title ||
        JSON.stringify(existing) !== JSON.stringify(cleanedMetadata);

      if (needsUpdate && !DRY_RUN) {
        await stripe.products.update(product.id, {
          name: title,
          metadata: cleanedMetadata,
          active: true
        });
        console.log(`✅ Cleaned + updated: ${title}`);
        updated++;
      } else {
        skipped++;
      }
    } catch (err) {
      console.error(`❌ Error updating ${product.name}: ${err.message}`);
      errored++;
    }
  }

  console.log(`🎉 DONE (${MODE.toUpperCase()}) → Updated: ${updated}, Skipped: ${skipped}, Errors: ${errored}`);
}

run().catch(err => console.error("❌ Fatal error:", err.message));