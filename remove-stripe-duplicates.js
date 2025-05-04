/**
 * remove-stripe-duplicates.js
 *
 * Purpose: Permanently deletes duplicate Stripe products based on `printful_variant_id`.
 * Use Case: Cleanup for both TEST and LIVE environments.
 * Mode: Always runs both environments in one go.
 */

import dotenv from "dotenv";
import Stripe from "stripe";
import { getAllStripeProducts } from "./utils.js";
dotenv.config();

const DRY_RUN = process.env.DRY_RUN === "true";

const STRIPE_KEYS = {
  test: process.env.STRIPE_SECRET_TEST,
  live: process.env.STRIPE_SECRET_KEY,
};

if (!STRIPE_KEYS.test || !STRIPE_KEYS.live) {
  throw new Error("❌ Missing Stripe keys.");
}

async function clean(mode) {
  const stripe = new Stripe(STRIPE_KEYS[mode], { apiVersion: "2023-10-16" });
  const products = await getAllStripeProducts(stripe);

  const map = new Map();

  for (const p of products) {
    const variantId = p.metadata?.printful_variant_id;
    if (!variantId) continue;
    if (!map.has(variantId)) map.set(variantId, []);
    map.get(variantId).push(p);
  }

  let deleted = 0, kept = 0, errors = 0;

  for (const [variantId, group] of map.entries()) {
    if (group.length <= 1) continue;

    const [latest, ...rest] = group.sort((a, b) => b.created - a.created);
    kept++;
    console.log(`✅ Keeping: ${latest.name} (${latest.id})`);

    for (const dupe of rest) {
      try {
        if (!DRY_RUN) {
          await stripe.products.del(dupe.id);
        }
        console.log(`❌ Deleted duplicate: ${dupe.name} (${dupe.id})`);
        deleted++;
      } catch (err) {
        console.error(`❌ Failed to delete ${dupe.id}: ${err.message}`);
        errors++;
      }
    }
  }

  console.log(`🧹 ${mode.toUpperCase()} CLEANUP → Kept: ${kept}, Deleted: ${deleted}, Errors: ${errors}`);
}

async function run() {
  await clean("test");
  await clean("live");
}

run();