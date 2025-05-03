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

async function ensureCleanAndUpdated(mode) {
  const stripe = new Stripe(STRIPE_KEYS[mode], { apiVersion: "2023-10-16" });
  console.log(`🔍 Verifying ${mode.toUpperCase()} product catalog...`);

  const archived = await getAllStripeProducts(stripe, { active: false });
  const active = await getAllStripeProducts(stripe, { active: true });

  const activeMap = new Map(
    active
      .filter(p => p.metadata?.printful_variant_id)
      .map(p => [p.metadata.printful_variant_id, p])
  );

  let updated = 0;
  let reactivated = 0;
  let skipped = 0;
  let errors = 0;

  for (const product of archived) {
    const variantId = product.metadata?.printful_variant_id;

    if (!variantId) {
      console.log(`⚠️ Skipped unnamed archived product: ${product.id}`);
      skipped++;
      continue;
    }

    const live = activeMap.get(variantId);
    const archivedMeta = product.metadata || {};

    if (live) {
      // Compare metadata
      const needsMetaUpdate = Object.entries(archivedMeta).some(
        ([k, v]) => live.metadata?.[k] !== v
      );

      if (needsMetaUpdate && !DRY_RUN) {
        await stripe.products.update(live.id, { metadata: archivedMeta });
        console.log(`🔁 Updated metadata on active product: ${live.name}`);
        updated++;
      } else {
        console.log(`✅ Active product is clean for variant ${variantId}`);
      }

      skipped++;
      continue;
    }

    // Reactivate archived product and ensure metadata is up to date
    try {
      if (!DRY_RUN) {
        await stripe.products.update(product.id, {
          active: true,
          metadata: archivedMeta,
        });
      }

      console.log(`🟢 Reactivated: ${product.name}`);
      reactivated++;
    } catch (err) {
      console.error(`❌ Failed to reactivate ${product.id}: ${err.message}`);
      errors++;
    }
  }

  console.log(`✅ ${mode.toUpperCase()} CLEANUP → Reactivated: ${reactivated}, Metadata Updated: ${updated}, Skipped: ${skipped}, Errors: ${errors}`);
}

async function run() {
  await ensureCleanAndUpdated("test");
  await ensureCleanAndUpdated("live");
}

run();