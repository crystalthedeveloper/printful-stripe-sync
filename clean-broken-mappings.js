// delete-archived-stripe-products.js
// Deletes all archived (inactive) Stripe products from TEST and LIVE environments

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

async function deleteArchivedProducts(mode) {
  const stripe = new Stripe(STRIPE_KEYS[mode], { apiVersion: "2023-10-16" });
  console.log(`🧹 Deleting ARCHIVED products in ${mode.toUpperCase()} mode...`);

  let deletedCount = 0;
  let hasMore = true;
  let starting_after;

  while (hasMore) {
    const res = await stripe.products.list({
      limit: 100,
      starting_after,
      active: false,
    });

    for (const product of res.data) {
      try {
        if (DRY_RUN) {
          console.log(`🧪 Would delete: ${product.id} (${product.name})`);
        } else {
          await stripe.products.del(product.id);
          console.log(`🗑️ Deleted archived product: ${product.id} (${product.name})`);
          deletedCount++;
        }
      } catch (err) {
        console.error(`❌ Failed to delete product ${product.id}:`, err.message);
      }
    }

    hasMore = res.has_more;
    if (res.data.length > 0) {
      starting_after = res.data[res.data.length - 1].id;
    }
  }

  console.log(`✅ Finished deleting ${deletedCount} archived products in ${mode.toUpperCase()} mode.`);
}

async function run() {
  await deleteArchivedProducts("test");
  await deleteArchivedProducts("live");
}

run();