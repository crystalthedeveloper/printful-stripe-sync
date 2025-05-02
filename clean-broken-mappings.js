// Deactivates all prices and deletes archived Stripe products (LIVE only)

import dotenv from "dotenv";
import Stripe from "stripe";
dotenv.config();

const DRY_RUN = process.env.DRY_RUN === "true";
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;

if (!STRIPE_SECRET_KEY) {
  throw new Error("❌ Missing STRIPE_SECRET_KEY in environment.");
}

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2023-10-16" });

async function deleteArchivedProducts() {
  console.log("🧹 Deleting ARCHIVED products in LIVE mode...");

  let deletedCount = 0;
  let hasMore = true;
  let starting_after;

  while (hasMore) {
    const res = await stripe.products.list({
      limit: 100,
      active: false, // Only archived products
      starting_after,
    });

    for (const product of res.data) {
      try {
        const prices = await stripe.prices.list({ product: product.id, limit: 100 });

        let allPricesInactive = true;

        for (const price of prices.data) {
          if (price.active) {
            allPricesInactive = false;
            if (!DRY_RUN) {
              await stripe.prices.update(price.id, { active: false });
              console.log(`⛔ Deactivated price: ${price.id}`);
            } else {
              console.log(`🧪 Would deactivate price: ${price.id}`);
            }
          }
        }

        // Delete product only if all prices are now inactive
        if (allPricesInactive) {
          if (!DRY_RUN) {
            await stripe.products.del(product.id);
            console.log(`🗑️ Deleted product: ${product.id} (${product.name})`);
            deletedCount++;
          } else {
            console.log(`🧪 Would delete product: ${product.id} (${product.name})`);
          }
        } else {
          console.warn(`⚠️ Skipped deletion. Some prices are still active for product: ${product.id}`);
        }
      } catch (err) {
        console.error(`❌ Failed to process product ${product.id}:`, err.message);
      }
    }

    hasMore = res.has_more;
    if (res.data.length > 0) {
      starting_after = res.data[res.data.length - 1].id;
    }
  }

  console.log(`✅ Deleted ${deletedCount} archived products in LIVE mode.`);
}

deleteArchivedProducts();