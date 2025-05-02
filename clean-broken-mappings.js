import dotenv from "dotenv";
import Stripe from "stripe";
dotenv.config();

const DRY_RUN = process.env.DRY_RUN === "true";
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;

if (!STRIPE_SECRET_KEY) {
  throw new Error("❌ Missing STRIPE_SECRET_KEY in environment.");
}

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2023-10-16" });

async function deleteAllProducts() {
  console.log("🧨 Deleting ALL Stripe products in LIVE mode...");

  let deletedCount = 0;
  let hasMore = true;
  let starting_after;

  while (hasMore) {
    const res = await stripe.products.list({
      limit: 100,
      starting_after,
    });

    for (const product of res.data) {
      try {
        // Step 1: Deactivate and remove prices
        const prices = await stripe.prices.list({ product: product.id, limit: 100 });
        for (const price of prices.data) {
          if (price.active && !DRY_RUN) {
            await stripe.prices.update(price.id, { active: false });
            console.log(`⛔ Deactivated price: ${price.id}`);
          }
        }

        // Step 2: Delete product
        if (!DRY_RUN) {
          await stripe.products.del(product.id);
          console.log(`🗑️ Deleted product: ${product.id} (${product.name})`);
          deletedCount++;
        } else {
          console.log(`🧪 Would delete product: ${product.id} (${product.name})`);
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

  console.log(`✅ Deleted ${deletedCount} products from Stripe.`);
}

deleteAllProducts();
