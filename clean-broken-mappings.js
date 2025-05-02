// clean-duplicate-stripe-products.js
// Deletes Stripe products with duplicate names (TEST + LIVE)

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
  console.log(`🧹 Deleting duplicate Stripe products in ${mode.toUpperCase()} mode...`);

  const products = await getAllStripeProducts(stripe);
  const seen = new Map(); // name => [product, product, ...]

  for (const product of products) {
    if (!seen.has(product.name)) {
      seen.set(product.name, []);
    }
    seen.get(product.name).push(product);
  }

  for (const [name, group] of seen.entries()) {
    if (group.length > 1) {
      group.sort((a, b) => b.created - a.created); // keep newest
      const [keep, ...duplicates] = group;

      for (const dup of duplicates) {
        try {
          if (DRY_RUN) {
            console.log(`🧪 Would delete product: ${dup.id} (${name})`);
          } else {
            await stripe.products.del(dup.id);
            console.log(`🗑️ Deleted duplicate product: ${dup.id} (${name})`);
          }
        } catch (err) {
          console.error(`❌ Failed to delete product ${dup.id}:`, err.message);
        }
      }
    }
  }

  console.log(`✅ Duplicate cleanup finished for ${mode.toUpperCase()}`);
}

async function run() {
  await removeDuplicates("test");
  await removeDuplicates("live");
}

run();