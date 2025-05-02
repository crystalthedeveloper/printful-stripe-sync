// clean-broken-mappings.js
// Deactivates prices and marks archived products as skipped in TEST and LIVE environments

import dotenv from "dotenv";
import Stripe from "stripe";
dotenv.config();

const DRY_RUN = process.env.DRY_RUN === "true";

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

async function reactivateArchivedProducts(mode) {
  const stripe = new Stripe(STRIPE_KEYS[mode], { apiVersion: "2023-10-16" });
  console.log(`🧹 Checking archived products in ${mode.toUpperCase()}...`);

  const archived = await getAllStripeProducts(stripe, { active: false });

  let reactivatedProducts = 0;
  let deactivatedPrices = 0;
  let errors = 0;

  for (const product of archived) {
    try {
      const prices = await stripe.prices.list({ product: product.id, limit: 100 });

      for (const price of prices.data) {
        if (price.active && !DRY_RUN) {
          await stripe.prices.update(price.id, { active: false });
          deactivatedPrices++;
        }
      }

      if (!DRY_RUN) {
        await stripe.products.update(product.id, {
          active: true,
          metadata: {
            ...product.metadata,
            reactivated_from_archived: "true",
          },
        });
        reactivatedProducts++;
      }

    } catch (err) {
      errors++;
    }
  }

  console.log(`✅ ${mode.toUpperCase()} REVIEW → Reactivated: ${reactivatedProducts}, Deactivated prices: ${deactivatedPrices}, Errors: ${errors}`);
}

async function run() {
  await reactivateArchivedProducts("test");
  await reactivateArchivedProducts("live");
}

run();