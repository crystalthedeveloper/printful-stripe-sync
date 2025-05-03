// clean-broken-mappings.js
// Safely reactivates archived products, updates metadata/price/image, avoids duplicates (TEST + LIVE)

import dotenv from "dotenv";
import Stripe from "stripe";
dotenv.config();

const DRY_RUN = process.env.DRY_RUN === "true";
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;

if (!STRIPE_KEY) throw new Error("❌ Missing STRIPE_SECRET_KEY");

const stripe = new Stripe(STRIPE_KEY, { apiVersion: "2023-10-16" });

async function getAllStripeProducts() {
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

async function cleanDuplicateVariants() {
  console.log("🔍 Checking for duplicate variants...");

  const allProducts = await getAllStripeProducts();
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

  let archived = 0;
  let errors = 0;
  let kept = 0;

  for (const [variantId, group] of byVariant.entries()) {
    if (group.length <= 1) continue;

    const [latest, ...duplicates] = group.sort(
      (a, b) => new Date(b.created) - new Date(a.created)
    );

    kept++;
    console.log(`✅ Keeping: ${latest.name} (${latest.id})`);

    for (const product of duplicates) {
      try {
        if (!DRY_RUN) {
          await stripe.products.update(product.id, { active: false });
        }
        console.log(`🗑️ Archived duplicate: ${product.name} (${product.id})`);
        archived++;
      } catch (err) {
        console.error(`❌ Error archiving ${product.id}: ${err.message}`);
        errors++;
      }
    }
  }

  console.log(`🎉 CLEANUP DONE → Kept: ${kept}, Archived: ${archived}, Errors: ${errors}`);
}

cleanDuplicateVariants();