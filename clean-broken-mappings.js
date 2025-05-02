// clean-printful-variants.js
// Scans Printful variants for missing preview images and deactivates related Stripe prices (test & live)

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

async function getAllStripePrices(stripe) {
  const prices = [];
  let hasMore = true;
  let starting_after;

  while (hasMore) {
    const res = await stripe.prices.list({
      limit: 100,
      starting_after,
    });
    prices.push(...res.data);
    hasMore = res.has_more;
    if (res.data.length > 0) {
      starting_after = res.data[res.data.length - 1].id;
    }
  }

  return prices;
}

async function scanAndClean(mode) {
  const stripe = new Stripe(STRIPE_KEYS[mode], { apiVersion: "2023-10-16" });
  console.log(`🔍 Scanning for broken variants in ${mode.toUpperCase()} mode...`);

  const brokenVariants = [];
  const productList = await getPrintfulProducts();
  const stripePrices = await getAllStripePrices(stripe);

  for (const product of productList) {
    const detailRes = await fetch(`https://api.printful.com/sync/products/${product.id}`, {
      headers: { Authorization: `Bearer ${PRINTFUL_API_KEY}` },
    });
    const detailData = await detailRes.json();
    const variants = detailData.result?.sync_variants || [];

    for (const variant of variants) {
      const hasPreview = variant?.files?.some(f => f.type === "preview");
      const variantId = String(variant.id);
      const variantName = variant.name;

      if (!hasPreview) {
        brokenVariants.push({ variant_id: variantId, name: variantName, product_id: product.id });
        console.warn(`⚠️ Missing preview for: ${variantName} (${variantId})`);

        if (!DRY_RUN) {
          const matches = stripePrices.filter(
            p => p.metadata?.printful_store_variant_id === variantId && p.active
          );

          for (const match of matches) {
            await stripe.prices.update(match.id, { active: false });
            console.log(`🗑️ Deactivated: ${match.id} (${variantName})`);
          }

          if (matches.length === 0) {
            console.log(`ℹ️ No active prices to deactivate for: ${variantName}`);
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