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

async function markArchivedProducts(mode) {
  const stripe = new Stripe(STRIPE_KEYS[mode], { apiVersion: "2023-10-16" });
  console.log(`🧹 Cleaning archived products in ${mode.toUpperCase()}...`);

  const archived = await getAllStripeProducts(stripe, { active: false });

  for (const product of archived) {
    try {
      const prices = await stripe.prices.list({ product: product.id, limit: 100 });

      for (const price of prices.data) {
        if (price.active && !DRY_RUN) {
          await stripe.prices.update(price.id, { active: false });
          console.log(`⛔ Deactivated price: ${price.id}`);
        } else {
          console.log(`🧪 Would deactivate price: ${price.id}`);
        }
      }

      if (!DRY_RUN) {
        const updatedName = product.name.startsWith("[SKIPPED] ")
          ? product.name
          : `[SKIPPED] ${product.name}`;

        await stripe.products.update(product.id, {
          name: updatedName,
          metadata: {
            ...product.metadata,
            deletion_skipped: "true",
          },
        });

        console.log(`🔖 Marked product as skipped: ${product.id}`);
      } else {
        console.log(`🧪 Would mark product as skipped: ${product.id}`);
      }

    } catch (err) {
      console.error(`❌ Error processing product ${product.id}: ${err.message}`);
    }
  }

  console.log(`✅ Done cleaning archived products in ${mode.toUpperCase()}`);
}

async function run() {
  await markArchivedProducts("test");
  await markArchivedProducts("live");
}

run();