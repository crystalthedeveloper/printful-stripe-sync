// clean-broken-mappings.js
// Safely reactivates archived products, updates metadata/price/image, avoids duplicates (TEST + LIVE)

import dotenv from "dotenv";
import Stripe from "stripe";
dotenv.config();

const DRY_RUN = process.env.DRY_RUN === "true";
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;

if (!STRIPE_KEY) {
  throw new Error("❌ Missing STRIPE_SECRET_KEY");
}

const stripe = new Stripe(STRIPE_KEY, { apiVersion: "2023-10-16" });

async function getAllStripeProducts({ active }) {
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

async function cleanDuplicates() {
  console.log("🔍 Starting product cleanup...");

  const active = await getAllStripeProducts({ active: true });
  const archived = await getAllStripeProducts({ active: false });
  const all = [...active, ...archived];

  const byVariant = new Map();
  const duplicates = [];

  for (const product of all) {
    const variantId = product.metadata?.printful_variant_id;
    if (!variantId) continue;

    if (!byVariant.has(variantId)) {
      byVariant.set(variantId, [product]);
    } else {
      byVariant.get(variantId).push(product);
    }
  }

  let deleted = 0;
  let updated = 0;
  let reactivated = 0;
  let skipped = 0;
  let errors = 0;

  for (const [variantId, products] of byVariant) {
    // Sort so the one most recently created stays
    const [keeper, ...rest] = products.sort(
      (a, b) => new Date(b.created) - new Date(a.created)
    );

    // Ensure the keeper is active
    if (!keeper.active && !DRY_RUN) {
      try {
        await stripe.products.update(keeper.id, { active: true });
        console.log(`🟢 Reactivated keeper: ${keeper.name}`);
        reactivated++;
      } catch (err) {
        console.error(`❌ Failed to reactivate ${keeper.id}: ${err.message}`);
        errors++;
        continue;
      }
    }

    // Delete all other duplicates
    for (const dupe of rest) {
      try {
        if (!DRY_RUN) {
          await stripe.products.update(dupe.id, { active: false }); // Archive instead of delete
        }
        console.log(`🗑️ Archived duplicate: ${dupe.name}`);
        deleted++;
      } catch (err) {
        console.error(`❌ Failed to archive ${dupe.id}: ${err.message}`);
        errors++;
      }
    }

    // Check if keeper metadata needs update
    const expected = keeper.metadata || {};
    const needsUpdate = Object.entries(expected).some(([key, val]) => keeper.metadata[key] !== val);

    if (needsUpdate && !DRY_RUN) {
      try {
        await stripe.products.update(keeper.id, { metadata: expected });
        console.log(`🔁 Updated metadata for ${keeper.name}`);
        updated++;
      } catch (err) {
        console.error(`❌ Failed to update metadata: ${err.message}`);
        errors++;
      }
    } else {
      skipped++;
    }
  }

  console.log(`✅ CLEANUP COMPLETE → Reactivated: ${reactivated}, Deleted: ${deleted}, Metadata Updated: ${updated}, Skipped: ${skipped}, Errors: ${errors}`);
}

cleanDuplicates();