/**
 * remove-stripe-duplicates.js
 * 
 * Removes Stripe product duplicates based on printful_variant_id.
 * Falls back to name match if metadata is missing.
 * Handles both TEST and LIVE modes.
 */

import dotenv from "dotenv";
import Stripe from "stripe";
import { getAllStripeProducts } from "./utils.js";
dotenv.config();

const DRY_RUN = process.env.DRY_RUN === "true";
const DELETE_ORPHANS = process.env.DELETE_ORPHANS === "true";
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

  const byName = new Map();
  let deleted = 0, kept = 0, skipped = 0, orphaned = 0, errors = 0;

  for (const p of products) {
    if (!byName.has(p.name)) {
      byName.set(p.name, [p]);
    } else {
      byName.get(p.name).push(p);
    }
  }

  console.log(`🔎 Checking ${byName.size} unique product names...`);

  for (const [name, group] of byName.entries()) {
    if (group.length <= 1) continue;

    // Prefer product with valid variant_id
    const valid = group.find(p => !!p.metadata?.printful_variant_id);
    const [keeper, ...rest] = valid
      ? [valid, ...group.filter(p => p.id !== valid.id)]
      : group.sort((a, b) => b.created - a.created);

    console.log(`\n📛 Duplicate group for "${name}":`);
    group.forEach(p => console.log(`   - ${p.name} (${p.id})`));

    console.log(`✅ Keeping: ${keeper.name} (${keeper.id})`);
    kept++;

    for (const d of rest) {
      try {
        if (!DRY_RUN) {
          await stripe.products.del(d.id);
        }
        console.log(`❌ Deleted duplicate: ${d.name} (${d.id})`);
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
