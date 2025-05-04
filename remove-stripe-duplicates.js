/**
 * remove-stripe-duplicates.js
 * 
 * Removes Stripe product duplicates based on printful_variant_id across test and live environments.
 */

import dotenv from "dotenv";
import Stripe from "stripe";
import { getAllStripeProducts } from "./utils.js";
dotenv.config();

const DRY_RUN = process.env.DRY_RUN === "true";
const DELETE_ORPHANS = process.env.DELETE_ORPHANS === "true"; // Optional: set true to remove those missing metadata

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
  let deleted = 0, kept = 0, errors = 0, skipped = 0, orphaned = 0;

  for (const p of products) {
    const variantId = p.metadata?.printful_variant_id;
    if (!variantId) {
      console.warn(`⚠️ Orphaned product (no variant ID): ${p.name} (${p.id})`);
      if (DELETE_ORPHANS && !DRY_RUN) {
        try {
          await stripe.products.del(p.id);
          console.log(`🗑️ Deleted orphan: ${p.name} (${p.id})`);
          orphaned++;
        } catch (err) {
          console.error(`❌ Failed to delete orphan ${p.id}: ${err.message}`);
          errors++;
        }
      }
      skipped++;
      continue;
    }

    if (!byVariant.has(variantId)) {
      byVariant.set(variantId, [p]);
    } else {
      byVariant.get(variantId).push(p);
    }
  }

  console.log(`🔎 Checking ${byVariant.size} unique variant IDs...`);

  for (const [variantId, group] of byVariant.entries()) {
    if (group.length <= 1) continue;

    console.log(`\n📛 Duplicate group for variant ${variantId}:`);
    group.forEach(p => console.log(`   - ${p.name} (${p.id})`));

    const [newest, ...duplicates] = group.sort((a, b) => b.created - a.created);
    console.log(`✅ Keeping: ${newest.name} (${newest.id})`);
    kept++;

    for (const d of duplicates) {
      try {
        if (!DRY_RUN) {
          await stripe.products.del(d.id);
        }
        console.log(`❌ Deleted: ${d.name} (${d.id})`);
        deleted++;
      } catch (err) {
        console.error(`❌ Error deleting ${d.id}: ${err.message}`);
        errors++;
      }
    }
  }

  console.log(`\n🧽 ${mode.toUpperCase()} CLEANUP SUMMARY → Kept: ${kept}, Deleted: ${deleted}, Orphans: ${orphaned}, Skipped: ${skipped}, Errors: ${errors}`);
}

async function run() {
  await removeDuplicates("test");
  await removeDuplicates("live");
}

run();