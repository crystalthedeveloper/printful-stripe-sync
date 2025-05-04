/**
 * remove-stripe-duplicates.js
 *
 * Purpose: Permanently delete duplicate Stripe products using the same `printful_variant_id`.
 * Mode: Handles both "test" and "live" environments in one run.
 *
 * Logic:
 * - Loads all Stripe products from each mode
 * - Maps by `printful_variant_id`
 * - Keeps most recent product (by `created`)
 * - Permanently deletes older duplicates
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
  console.log(`📦 Total products fetched: ${products.length}`);

  const byVariant = new Map();

  for (const p of products) {
    const variantId = p.metadata?.printful_variant_id;
    if (!variantId) {
      console.warn(`⚠️ Skipping product with no variant ID: ${p.name} (${p.id})`);
      continue;
    }

    if (!byVariant.has(variantId)) {
      byVariant.set(variantId, [p]);
    } else {
      byVariant.get(variantId).push(p);
    }
  }

  console.log(`🔎 Checking for duplicates among ${byVariant.size} unique variant IDs...`);

  let deleted = 0;
  let kept = 0;
  let errors = 0;

  for (const [variantId, group] of byVariant.entries()) {
    if (group.length <= 1) continue;

    console.log(`\n📛 Duplicate group for variant ${variantId}: ${group.length} items`);

    const sorted = group.sort((a, b) => b.created - a.created); // newest first
    const [newest, ...duplicates] = sorted;

    console.log(`✅ Keeping: ${newest.name} (${newest.id})`);
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