/**
 * remove-stripe-duplicates.js
 *
 * Purpose: Permanently delete duplicate Stripe products using the same `printful_variant_id`.
 * Mode: Handles both "test" and "live" environments in one run.
 *
 * Logic:
 * - Loads all Stripe products from each mode
 * - Maps by `printful_variant_id`
 * - Keeps most recent product (based on UNIX timestamp `created`)
 * - Permanently deletes the older duplicates
 */

import dotenv from "dotenv";
import Stripe from "stripe";
import { getAllStripeProducts } from "./utils.js";
dotenv.config();

const DRY_RUN = process.env.DRY_RUN === "true";
const MODES = {
  test: process.env.STRIPE_SECRET_TEST,
  live: process.env.STRIPE_SECRET_KEY,
};

if (!MODES.test || !MODES.live) {
  throw new Error("❌ Missing test or live Stripe secret key.");
}

async function removeDuplicates(mode) {
  const stripe = new Stripe(MODES[mode], { apiVersion: "2023-10-16" });
  console.log(`\n🧹 Starting cleanup in ${mode.toUpperCase()} mode...`);

  const products = await getAllStripeProducts(stripe);
  const byVariant = new Map();

  for (const product of products) {
    const variantId = product.metadata?.printful_variant_id;
    if (!variantId) continue;

    if (!byVariant.has(variantId)) {
      byVariant.set(variantId, [product]);
    } else {
      byVariant.get(variantId).push(product);
    }
  }

  let deleted = 0;
  let kept = 0;
  let errors = 0;

  for (const [variantId, list] of byVariant.entries()) {
    if (list.length <= 1) continue;

    // Sort by Stripe product `created` (a UNIX timestamp)
    const sorted = list.sort((a, b) => b.created - a.created);
    const [newest, ...duplicates] = sorted;

    console.log(`\n✅ Keeping: ${newest.name} (${newest.id}) for variant ${variantId}`);
    kept++;

    for (const dupe of duplicates) {
      try {
        if (!DRY_RUN) {
          await stripe.products.del(dupe.id);
        }
        console.log(`❌ Deleted duplicate: ${dupe.name} (${dupe.id})`);
        deleted++;
      } catch (err) {
        console.error(`❌ Error deleting ${dupe.id}: ${err.message}`);
        errors++;
      }
    }
  }

  console.log(`\n🧽 ${mode.toUpperCase()} CLEANUP SUMMARY → Kept: ${kept}, Deleted: ${deleted}, Errors: ${errors}`);
}

async function run() {
  await removeDuplicates("test");
  await removeDuplicates("live");
}

run();