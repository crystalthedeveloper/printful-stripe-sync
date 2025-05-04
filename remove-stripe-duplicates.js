/**
 * remove-stripe-duplicates.js
 *
 * Deletes all Stripe products in TEST mode (clean slate).
 * In LIVE mode, only detects duplicates and skips deletions.
 */

import dotenv from "dotenv";
import Stripe from "stripe";
import { getAllStripeProducts } from "./utils.js";
dotenv.config();

const DRY_RUN = process.env.DRY_RUN === "true";
const DELETE_ALL_IN_TEST_MODE = process.env.DELETE_ALL_IN_TEST_MODE === "true";
const DELETE_ORPHANS = process.env.DELETE_ORPHANS === "true";

const MODES = {
  test: process.env.STRIPE_SECRET_TEST,
  live: process.env.STRIPE_SECRET_KEY,
};

if (!MODES.test || !MODES.live) {
  throw new Error("❌ Missing test or live Stripe secret key.");
}

async function deleteProductAndPrices(stripe, productId, allowDelete) {
  try {
    const prices = await stripe.prices.list({ product: productId, limit: 100 });
    for (const price of prices.data) {
      if (!DRY_RUN && allowDelete) {
        await stripe.prices.update(price.id, { active: false });
      }
      console.log(`🔻 Deactivated price: ${price.id}`);
    }

    if (!DRY_RUN && allowDelete) {
      await stripe.products.del(productId);
      console.log(`❌ Deleted product: ${productId}`);
    }

    return allowDelete;
  } catch (err) {
    console.error(`❌ Error deleting product ${productId}: ${err.message}`);
    return false;
  }
}

async function removeDuplicates(mode) {
  const stripe = new Stripe(MODES[mode], { apiVersion: "2023-10-16" });
  const allowDelete = mode === "test";

  console.log(`\n🧹 Starting cleanup in ${mode.toUpperCase()} mode...`);

  const products = await getAllStripeProducts(stripe);
  console.log(`📦 Total products fetched: ${products.length}`);

  let deleted = 0, skipped = 0, errors = 0;

  if (mode === "test" && DELETE_ALL_IN_TEST_MODE) {
    console.log("🧨 DELETE_ALL_IN_TEST_MODE is enabled — purging everything...");
    for (const p of products) {
      const success = await deleteProductAndPrices(stripe, p.id, true);
      success ? deleted++ : errors++;
    }
  } else {
    const byKey = new Map();

    for (const p of products) {
      const variantId = p.metadata?.printful_variant_id;
      const key = variantId || p.name.trim().toLowerCase(); // fallback

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

      for (const dupe of duplicates) {
        const success = await deleteProductAndPrices(stripe, dupe.id, allowDelete);
        success ? deleted++ : errors++;
      }
    }
  }

  console.log(`\n🧽 ${mode.toUpperCase()} CLEANUP SUMMARY → Deleted: ${deleted}, Skipped: ${skipped}, Errors: ${errors}`);
}

async function run() {
  await removeDuplicates("test");
  await removeDuplicates("live");
}

run();