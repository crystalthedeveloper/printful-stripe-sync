/**
 * remove-stripe-duplicates.js
 *
 * Deletes duplicate Stripe products by printful_variant_id or fallback normalized name.
 * Handles both test and live environments.
 * Deactivates prices before deleting a product.
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

async function deleteProductAndPrices(stripe, productId) {
  try {
    const prices = await stripe.prices.list({ product: productId, limit: 100 });
    for (const price of prices.data) {
      if (!DRY_RUN) {
        await stripe.prices.update(price.id, { active: false });
      }
      console.log(`🔻 Deactivated price: ${price.id}`);
    }

    if (!DRY_RUN) {
      await stripe.products.del(productId);
    }

    console.log(`❌ Deleted product: ${productId}`);
    return true;
  } catch (err) {
    console.error(`❌ Error deleting product ${productId}: ${err.message}`);
    return false;
  }
}

async function removeDuplicates(mode) {
  const stripe = new Stripe(MODES[mode], { apiVersion: "2023-10-16" });
  console.log(`\n🧹 Starting cleanup in ${mode.toUpperCase()} mode...`);

  const products = await getAllStripeProducts(stripe);
  console.log(`📦 Total products fetched: ${products.length}`);

  const byKey = new Map();
  let deleted = 0, kept = 0, skipped = 0, orphaned = 0, errors = 0;

  for (const p of products) {
    const variantId = p.metadata?.printful_variant_id;
    const key = variantId || p.name.trim().toLowerCase(); // normalize name fallback

    if (!variantId) {
      console.warn(`⚠️ Orphaned product (no variant ID): ${p.name} (${p.id})`);
      if (DELETE_ORPHANS && !DRY_RUN) {
        const success = await deleteProductAndPrices(stripe, p.id);
        if (success) orphaned++;
        else errors++;
      }
      skipped++;
    }

    if (!byKey.has(key)) {
      byKey.set(key, [p]);
    } else {
      byKey.get(key).push(p);
    }
  }

  console.log(`\n📌 Key map breakdown:`);
  for (const [key, group] of byKey.entries()) {
    console.log(`🧵 ${key}: ${group.length} product(s)`);
  }

  console.log(`🔎 Checking ${byKey.size} keys (variantId or fallback name)...`);

  for (const [key, group] of byKey.entries()) {
    if (group.length <= 1) continue;

    console.log(`\n🔥 Duplicate group for key: ${key}`);
    group.forEach(p => console.log(`   - ${p.name} (${p.id})`));

    const sorted = group.sort((a, b) => b.created - a.created).reverse();
    const [newest, ...duplicates] = sorted;

    console.log(`✅ Keeping: ${newest.name} (${newest.id})`);
    kept++;

    for (const dupe of duplicates) {
      const success = await deleteProductAndPrices(stripe, dupe.id);
      if (success) deleted++;
      else errors++;
    }
  }

  console.log(`\n🧽 ${mode.toUpperCase()} CLEANUP SUMMARY → Kept: ${kept}, Deleted: ${deleted}, Orphans: ${orphaned}, Skipped: ${skipped}, Errors: ${errors}`);
}

async function run() {
  await removeDuplicates("test");
  await removeDuplicates("live");
}

run();