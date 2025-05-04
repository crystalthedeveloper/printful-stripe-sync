/**
 * sync-printful-products.js
 *
 * Purpose: Sync Printful products/variants to Stripe (create if not exists, update if changed).
 * - Always overwrites metadata and name
 * - Never archives anything
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
if (!process.env.PRINTFUL_API_KEY) throw new Error("❌ Missing PRINTFUL_API_KEY");

const stripe = new Stripe(STRIPE_KEY, { apiVersion: "2023-10-16" });

async function run() {
  console.log(`🚀 Syncing Printful → Stripe in ${MODE.toUpperCase()} mode...`);
  const products = await getPrintfulProducts();

  let added = 0,
    updated = 0,
    skipped = 0,
    errored = 0;

  for (const p of products) {
    try {
      if (!p.metadata?.printful_variant_id || !p.price) {
        console.warn(`⚠️ Skipping incomplete product: ${p.title}`);
        skipped++;
        continue;
      }

      const existing = await stripe.products.search({
        query: `metadata['printful_variant_id']:'${p.metadata.printful_variant_id}'`,
      });

      if (existing.data.length > 0) {
        const product = existing.data[0];
        if (!DRY_RUN) {
          await stripe.products.update(product.id, {
            name: p.title,
            metadata: p.metadata,
            active: true, // re-activate if archived
          });
        }
        console.log(`🔁 Updated: ${p.title}`);
        updated++;
      } else {
        const created = await stripe.products.create({
          name: p.title,
          metadata: p.metadata,
          active: true,
        });
        console.log(`➕ Created: ${p.title}`);
        added++;
      }

      await ensurePriceExists(
        stripe,
        existing.data[0]?.id || created?.id,
        p.price,
        p.metadata.printful_variant_id,
        p.metadata.image_url,
        DRY_RUN
      );
    } catch (err) {
      console.error(`❌ Error syncing ${p.title}: ${err.message}`);
      errored++;
    }
  }

  console.log(
    `✅ SYNC COMPLETE (${MODE.toUpperCase()}) → Added: ${added}, Updated: ${updated}, Skipped: ${skipped}, Errors: ${errored}`
  );
}

run();