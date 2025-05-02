
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

async function getAllStripeProducts(stripe, { active } = {}) {
  const products = [];
  let hasMore = true;
  let starting_after;

  while (hasMore) {
    const res = await stripe.products.list({
      limit: 100,
      starting_after,
      ...(typeof active === "boolean" ? { active } : {}),
    });
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
  const seen = new Map();

  for (const product of products) {
    const key = product.name?.trim();
    if (!key) continue;

    if (!seen.has(key)) {
      seen.set(key, []);
    }
    seen.get(key).push(product);
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
}

async function deleteArchivedProducts(mode) {
  const stripe = new Stripe(STRIPE_KEYS[mode], { apiVersion: "2023-10-16" });
  console.log(`🗑️ Deleting archived products in ${mode.toUpperCase()}...`);

  const archived = await getAllStripeProducts(stripe, { active: false });

  for (const product of archived) {
    try {
      const prices = await stripe.prices.list({ product: product.id, limit: 100 });
      for (const price of prices.data) {
        if (price.active && !DRY_RUN) {
          await stripe.prices.update(price.id, { active: false });
          console.log(`⛔ Deactivated price: ${price.id}`);
        } else if (price.active) {
          console.log(`🧪 Would deactivate price: ${price.id}`);
        }
      }

      if (!DRY_RUN) {
        await stripe.products.del(product.id);
        console.log(`🗑️ Deleted archived product: ${product.id} (${product.name})`);
      } else {
        console.log(`🧪 Would delete: ${product.id} (${product.name})`);
      }
    } catch (err) {
      console.error(`❌ Failed to delete ${product.id}:`, err.message);
    }
  }

  console.log(`✅ Done cleaning deleted products in ${mode.toUpperCase()}`);
}

async function run() {
  await removeDuplicates("test");
  await removeDuplicates("live");

  await deleteArchivedProducts("test");
  await deleteArchivedProducts("live");
}

run();