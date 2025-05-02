// clean-broken-mappings.js
// Deletes all ARCHIVED (inactive) Stripe products in LIVE mode for cleanup

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
      active: false, // only archived
      starting_after,
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

  console.log(`✅ Deleted ${deletedCount} archived products in LIVE mode.`);
}

deleteArchivedProducts();