// Deletes archived Stripe products in LIVE mode (only after deleting all their prices)

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
      active: false,
      starting_after,
    });

    for (const product of res.data) {
      try {
        // Step 1: Delete prices
        const prices = await stripe.prices.list({ product: product.id, limit: 100 });
        for (const price of prices.data) {
          if (!price.deleted) {
            if (DRY_RUN) {
              console.log(`🧪 Would delete price: ${price.id}`);
            } else {
              await stripe.prices.update(price.id, { active: false });
              await stripe.prices.del(price.id); // 💥 Use correct method
              console.log(`🗑️ Deleted price: ${price.id}`);
            }
          }
        }

        // Step 2: Delete the product
        if (DRY_RUN) {
          console.log(`🧪 Would delete product: ${product.id} (${product.name})`);
        } else {
          await stripe.products.del(product.id);
          console.log(`🗑️ Deleted product: ${product.id} (${product.name})`);
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

  console.log(`✅ Deleted ${deletedCount} archived products in LIVE mode.`);
}

deleteArchivedProducts();