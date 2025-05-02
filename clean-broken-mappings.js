// clean-printful-variants.js
// Deactivates prices and deletes products for variants missing preview images (TEST + LIVE)

import dotenv from "dotenv";
import Stripe from "stripe";
import fetch from "node-fetch";
dotenv.config();

const DRY_RUN = process.env.DRY_RUN === "true";
const delayMs = 200;

const PRINTFUL_API_KEY = process.env.PRINTFUL_API_KEY;
const STRIPE_KEYS = {
  test: process.env.STRIPE_SECRET_TEST,
  live: process.env.STRIPE_SECRET_KEY,
};

if (!PRINTFUL_API_KEY || !STRIPE_KEYS.test || !STRIPE_KEYS.live) {
  throw new Error("❌ Missing PRINTFUL_API_KEY or Stripe secrets.");
}

async function getPrintfulProducts() {
  const res = await fetch("https://api.printful.com/sync/products", {
    headers: { Authorization: `Bearer ${PRINTFUL_API_KEY}` },
  });
  const data = await res.json();
  return data.result;
}

async function getAllStripeProducts(stripe) {
  const products = [];
  let hasMore = true;
  let starting_after;

  while (hasMore) {
    const res = await stripe.products.list({ limit: 100, starting_after });
    products.push(...res.data);
    hasMore = res.has_more;
    if (res.data.length > 0) {
      starting_after = res.data[res.data.length - 1].id;
    }
  }

  return products;
}

async function scanAndClean(mode) {
  const stripe = new Stripe(STRIPE_KEYS[mode], { apiVersion: "2023-10-16" });
  console.log(`🔍 Scanning for broken variants in ${mode.toUpperCase()} mode...`);

  const brokenVariants = [];
  const printfulProducts = await getPrintfulProducts();
  const stripeProducts = await getAllStripeProducts(stripe);

  for (const product of printfulProducts) {
    const detailRes = await fetch(`https://api.printful.com/sync/products/${product.id}`, {
      headers: { Authorization: `Bearer ${PRINTFUL_API_KEY}` },
    });

    const detailData = await detailRes.json();
    const variants = detailData.result?.sync_variants || [];

    for (const variant of variants) {
      const variantId = String(variant.id);
      const variantName = variant.name;
      const hasPreview = variant?.files?.some(f => f.type === "preview");

      if (!hasPreview) {
        brokenVariants.push({ variant_id: variantId, name: variantName });

        console.warn(`⚠️ Missing preview for: ${variantName} (${variantId})`);

        for (const product of stripeProducts) {
          if (
            product.metadata?.printful_variant_id === variantId ||
            product.name.includes(variantName)
          ) {
            if (!DRY_RUN) {
              try {
                await stripe.products.update(product.id, { active: false });
                console.log(`🗑️ Deactivated product: ${product.id} (${variantName})`);
              } catch (err) {
                console.error(`❌ Failed to deactivate product ${product.id}:`, err.message);
              }
            } else {
              console.log(`🧪 Would deactivate product: ${product.id} (${variantName})`);
            }
          }
        }
      }
    }

    await new Promise((res) => setTimeout(res, delayMs));
  }

  if (brokenVariants.length === 0) {
    console.log(`✅ All variants have preview images in ${mode.toUpperCase()} mode.`);
  } else {
    console.log(`⚠️ Found ${brokenVariants.length} broken variants in ${mode.toUpperCase()}:`);
    console.table(brokenVariants);
  }
}

async function run() {
  await scanAndClean("test");
  await scanAndClean("live");
}

run();