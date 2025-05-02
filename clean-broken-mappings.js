
// clean-broken-mappings.js
// Deletes duplicate Stripe products by name in both TEST and LIVE environments

import dotenv from "dotenv";
import Stripe from "stripe";
dotenv.config();

const DRY_RUN = process.env.DRY_RUN === "true";
const FORCE_DELETE_PRICES = process.env.FORCE_DELETE_PRICES === "true";

const STRIPE_KEYS = {
  test: process.env.STRIPE_SECRET_TEST,
  live: process.env.STRIPE_SECRET_KEY,
};

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

async function deleteArchivedProducts(mode) {
  const stripe = new Stripe(STRIPE_KEYS[mode], { apiVersion: "2023-10-16" });
  console.log(`🗑️ Deleting archived products in ${mode.toUpperCase()}...`);

  const archived = await getAllStripeProducts(stripe, { active: false });

  for (const product of archived) {
    try {
      const prices = await stripe.prices.list({ product: product.id, limit: 100 });

      for (const price of prices.data) {
        if (FORCE_DELETE_PRICES && !DRY_RUN) {
          await stripe.prices.del(price.id);
          console.log(`🗑️ Force-deleted price: ${price.id}`);
        } else if (price.active && !DRY_RUN) {
          await stripe.prices.update(price.id, { active: false });
          console.log(`⛔ Deactivated price: ${price.id}`);
        } else {
          console.log(`🧪 Would delete/deactivate price: ${price.id}`);
        }
      }

      // Re-check if prices still exist
      const remainingPrices = await stripe.prices.list({ product: product.id, limit: 100 });
      const anyRemaining = remainingPrices.data.some(p => !p.deleted);

      if (anyRemaining) {
        console.warn(`🚫 Skipping product ${product.id}: Still has active or undeleted prices.`);
        continue;
      }

      if (!DRY_RUN) {
        await stripe.products.del(product.id);
        console.log(`🗑️ Deleted product: ${product.id}`);
      } else {
        console.log(`🧪 Would delete product: ${product.id}`);
      }
    } catch (err) {
      console.error(`❌ Failed to delete ${product.id}:`, err.message);
    }
  }

  console.log(`✅ Done cleaning deleted products in ${mode.toUpperCase()}`);
}

async function run() {
  await deleteArchivedProducts("test");
  await deleteArchivedProducts("live");
}

run();