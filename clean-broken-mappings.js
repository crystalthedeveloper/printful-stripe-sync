// clean-duplicate-stripe-products.js
// Archives Stripe products with duplicate names (TEST + LIVE)

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
  console.log(`🧹 Cleaning duplicates in ${mode.toUpperCase()} mode...`);

  const products = await getAllStripeProducts(stripe);
  const seen = new Map(); // name -> [products[]]

  for (const product of products) {
    if (!seen.has(product.name)) {
      seen.set(product.name, []);
    }
    seen.get(product.name).push(product);
  }

  for (const [name, entries] of seen.entries()) {
    if (entries.length > 1) {
      // Sort by created date, keep the latest
      entries.sort((a, b) => b.created - a.created);
      const [keep, ...duplicates] = entries;

      for (const dup of duplicates) {
        if (!DRY_RUN) {
          try {
            await stripe.products.update(dup.id, { active: false });
            console.log(`🗑️ Archived duplicate product: ${dup.id} (${name})`);
          } catch (err) {
            console.error(`❌ Failed to archive product ${dup.id}:`, err.message);
          }
        } else {
          console.log(`🧪 Would archive duplicate: ${dup.id} (${name})`);
        }
      }
    }
  }

  console.log(`✅ Done cleaning ${mode.toUpperCase()} duplicates.`);
}

async function run() {
  await removeDuplicates("test");
  await removeDuplicates("live");
}

run();