// clean-broken-mappings.js
// Reactivates archived products and prevents duplicate/dirty names (TEST + LIVE)

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
  console.log(`🧹 Reactivating archived products in ${mode.toUpperCase()}...`);

  const archived = await getAllStripeProducts(stripe, { active: false });
  const activeProducts = await getAllStripeProducts(stripe, { active: true });

  const activeNames = new Set(activeProducts.map(p => p.name.replace(/^\[SKIPPED\]\s*/, "").trim()));

  let reactivatedProducts = 0;
  let deactivatedPrices = 0;
  let errors = 0;

  for (const product of archived) {
    try {
      const originalName = product.name;
      const cleanName = originalName.replace(/^\[SKIPPED\]\s*/, "").trim();

      // Skip if another active product already uses this name
      if (activeNames.has(cleanName)) {
        console.log(`⚠️ Skipping reactivation — duplicate name exists: "${cleanName}"`);
        continue;
      }

      // Deactivate any active prices just in case
      const prices = await stripe.prices.list({ product: product.id, limit: 100 });
      for (const price of prices.data) {
        if (price.active && !DRY_RUN) {
          await stripe.prices.update(price.id, { active: false });
          deactivatedPrices++;
        }
      }

      if (!DRY_RUN) {
        await stripe.products.update(product.id, {
          name: cleanName,
          active: true,
        });
        reactivatedProducts++;
        console.log(`✅ Reactivated product: ${cleanName}`);
      } else {
        console.log(`🧪 Would reactivate: ${cleanName}`);
      }

    } catch (err) {
      errors++;
      console.error(`❌ Error on ${product.id}: ${err.message}`);
    }
  }

  console.log(`✅ ${mode.toUpperCase()} CLEANUP → Reactivated: ${reactivatedProducts}, Deactivated prices: ${deactivatedPrices}, Errors: ${errors}`);
}

async function run() {
  await reactivateArchivedProducts("test");
  await reactivateArchivedProducts("live");
}

run();