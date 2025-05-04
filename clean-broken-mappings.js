// clean-broken-mappings.js
// Safely reactivates archived products, updates metadata/price/image, avoids duplicates (TEST + LIVE)

import dotenv from "dotenv";
import Stripe from "stripe";
dotenv.config();

const DRY_RUN = process.env.DRY_RUN === "true";
const STRIPE_KEYS = {
  test: process.env.STRIPE_SECRET_TEST,
  live: process.env.STRIPE_SECRET_KEY,
};

if (!STRIPE_KEYS.test || !STRIPE_KEYS.live) {
  throw new Error("❌ Missing Stripe test/live keys in environment.");
}

async function getAllStripeProducts(stripe) {
  const products = [];
  let hasMore = true;
  let starting_after;

  while (hasMore) {
    const res = await stripe.products.list({
      limit: 100,
      starting_after,
    });
    products.push(...res.data);
    hasMore = res.has_more;
    if (res.data.length > 0) {
      starting_after = res.data[res.data.length - 1].id;
    }
  }

  return products;
}

async function cleanDuplicates(mode) {
  const stripe = new Stripe(STRIPE_KEYS[mode], { apiVersion: "2023-10-16" });
  console.log(`🔍 Cleaning duplicates in ${mode.toUpperCase()}...`);

  const allProducts = await getAllStripeProducts(stripe);
  const byVariant = new Map();

  for (const product of allProducts) {
    const variantId = product.metadata?.printful_variant_id;
    if (!variantId) continue;

    if (!byVariant.has(variantId)) {
      byVariant.set(variantId, [product]);
    } else {
      byVariant.get(variantId).push(product);
    }
  }

  let deleted = 0, kept = 0, errors = 0;

  for (const [variantId, group] of byVariant.entries()) {
    if (group.length <= 1) continue;

    const [keeper, ...duplicates] = group.sort(
      (a, b) => new Date(b.created) - new Date(a.created)
    );

    kept++;
    console.log(`✅ Keeping: ${keeper.name} (${keeper.id})`);

    for (const dupe of duplicates) {
      try {
        if (!DRY_RUN) {
          await stripe.products.del(dupe.id);
        }
        console.log(`❌ Deleted duplicate: ${dupe.name} (${dupe.id})`);
        deleted++;
      } catch (err) {
        console.error(`❌ Error deleting ${dupe.id}: ${err.message}`);
        errors++;
      }
    }
  }

  console.log(`🧹 ${mode.toUpperCase()} CLEANUP → Kept: ${kept}, Deleted: ${deleted}, Errors: ${errors}`);
}

async function run() {
  await cleanDuplicates("test");
  await cleanDuplicates("live");
}

run();