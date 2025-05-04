/**
 * remove-stripe-duplicates.js
 *
 * Purpose: Permanently delete duplicate Stripe products using the same `printful_variant_id`.
 * Mode: Handles both "test" and "live" environments in one run.
 *
 * Logic:
 * - Loads all Stripe products from each mode
 * - Maps by `printful_variant_id`
 * - Keeps most recent product (by created date)
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
  console.log(`🧹 Removing duplicates in ${mode.toUpperCase()}...`);

  const products = await getAllStripeProducts(stripe);
  const byVariant = new Map();

  for (const p of products) {
    const id = p.metadata?.printful_variant_id;
    if (!id) continue;

    if (!byVariant.has(id)) {
      byVariant.set(id, [p]);
    } else {
      byVariant.get(id).push(p);
    }
  }

  let deleted = 0,
    kept = 0,
    errors = 0;

  for (const [variantId, list] of byVariant.entries()) {
    if (list.length <= 1) continue;

    const [newest, ...rest] = list.sort(
      (a, b) => new Date(b.created) - new Date(a.created)
    );

    kept++;
    console.log(`✅ Keeping: ${newest.name} (${newest.id})`);

    for (const dupe of rest) {
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

  console.log(
    `🧽 ${mode.toUpperCase()} CLEANUP → Kept: ${kept}, Deleted: ${deleted}, Errors: ${errors}`
  );
}

async function run() {
  await removeDuplicates("test");
  await removeDuplicates("live");
}

run();