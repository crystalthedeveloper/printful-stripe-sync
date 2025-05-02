// clean-printful-variants.js
// Scans Printful variants for missing preview images and deactivates related Stripe prices in both TEST and LIVE environments

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
  throw new Error("❌ Missing PRINTFUL_API_KEY or Stripe secrets in environment.");
}

async function getPrintfulProducts() {
  const productRes = await fetch("https://api.printful.com/sync/products", {
    headers: { Authorization: `Bearer ${PRINTFUL_API_KEY}` },
  });

  const result = await productRes.json();
  return result.result;
}

async function scanAndClean(mode) {
  const stripe = new Stripe(STRIPE_KEYS[mode], { apiVersion: "2023-10-16" });
  console.log(`🔍 Scanning for broken variants in ${mode.toUpperCase()} mode...`);
  const brokenVariants = [];
  const productList = await getPrintfulProducts();

  for (const product of productList) {
    const detailRes = await fetch(`https://api.printful.com/sync/products/${product.id}`, {
      headers: { Authorization: `Bearer ${PRINTFUL_API_KEY}` },
    });

    const detailData = await detailRes.json();
    const syncVariants = detailData.result?.sync_variants;

    for (const variant of syncVariants) {
      const hasPreview = variant?.files?.some(f => f.type === "preview");
      const variantId = String(variant.id);
      const variantName = variant.name;

      if (!hasPreview) {
        brokenVariants.push({ variant_id: variantId, name: variantName, product_id: product.id });
        console.warn(`⚠️ Missing preview image for variant: ${variantName} (${variantId})`);

        if (!DRY_RUN) {
          try {
            // Deactivate *all* matching prices with that variant_id (avoid leaving duplicates active)
            const prices = await stripe.prices.list({ limit: 100 });

            const matches = prices.data.filter(
              p => p.metadata?.printful_store_variant_id === variantId && p.active
            );

            for (const match of matches) {
              await stripe.prices.update(match.id, { active: false });
              console.log(`🗑️ Deactivated price ${match.id} for variant ${variantName} (${mode})`);
            }

            if (matches.length === 0) {
              console.log(`ℹ️ No active prices to deactivate for: ${variantName} (${variantId})`);
            }
          } catch (err) {
            console.error(`❌ Failed to deactivate prices for variant ${variantName}:`, err.message);
          }
        }
      }
    }

    await new Promise(res => setTimeout(res, delayMs));
  }

  if (!brokenVariants.length) {
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