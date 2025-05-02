
// clean-broken-mappings.js
// Deletes duplicate Stripe products by name in both TEST and LIVE environments

import dotenv from "dotenv";
import Stripe from "stripe";
dotenv.config();

const DRY_RUN = process.env.DRY_RUN === "true";
const STRIPE_KEYS = {
  test: process.env.STRIPE_SECRET_TEST,
  live: process.env.STRIPE_SECRET_KEY,
};

if (!STRIPE_KEYS.test || !STRIPE_KEYS.live) {
  throw new Error("❌ Missing Stripe secret keys.");
}

async function getAllStripeProducts(stripe) {
  const products = [];
  let hasMore = true;
  let starting_after;

  while (hasMore) {
    const res = await stripe.products.list({ limit: 100, starting_after });
    products.push(...res.data);
    hasMore = res.has_more;
    if (res.data.length > 0) {
      starting_after = res.data[res.data.length - 1].id;
    }
  }

  return products;
}

async function removeDuplicates(mode) {
  const stripe = new Stripe(STRIPE_KEYS[mode], { apiVersion: "2023-10-16" });
  console.log(`🧹 Cleaning duplicate products in ${mode.toUpperCase()}...`);

  const products = await getAllStripeProducts(stripe);
  const seen = new Map(); // name -> [product, product, ...]

  for (const product of products) {
    if (!seen.has(product.name)) {
      seen.set(product.name, []);
    }
    seen.get(product.name).push(product);
  }

  for (const [name, group] of seen.entries()) {
    if (group.length > 1) {
      group.sort((a, b) => b.created - a.created); // newest first
      const [keep, ...duplicates] = group;

      for (const dup of duplicates) {
        try {
          if (!DRY_RUN) {
            await stripe.products.update(dup.id, { active: false });
            console.log(`⛔ Archived duplicate: ${dup.id} (${name})`);
          } else {
            console.log(`🧪 Would archive duplicate: ${dup.id} (${name})`);
          }
        } catch (err) {
          console.error(`❌ Failed to archive ${dup.id}:`, err.message);
        }
      }
    }
  }

  console.log(`✅ Finished duplicate cleanup in ${mode.toUpperCase()}`);
}

async function run() {
  await removeDuplicates("test");
  await removeDuplicates("live");
}

run();