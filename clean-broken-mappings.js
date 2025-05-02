// clean-printful-variants.js
//with product search, preview validation, price deactivation, and metadata update related Stripe prices (test & live)

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

async function findStripeProductByName(stripe, name) {
  try {
    const result = await stripe.products.search({
      query: `name:"${name}"`,
    });
    return result.data[0] || null;
  } catch (err) {
    console.error(`❌ Failed to search for product "${name}":`, err.message);
    return null;
  }
}

async function scanAndClean(mode) {
  const stripe = new Stripe(STRIPE_KEYS[mode], { apiVersion: "2023-10-16" });
  console.log(`🔍 Cleaning broken mappings in ${mode.toUpperCase()}...`);

  const brokenVariants = [];
  const productList = await getPrintfulProducts();

  for (const product of productList) {
    const detailRes = await fetch(`https://api.printful.com/sync/products/${product.id}`, {
      headers: { Authorization: `Bearer ${PRINTFUL_API_KEY}` },
    });
    const detailData = await detailRes.json();
    const productName = detailData.result?.sync_product?.name;
    const variants = detailData.result?.sync_variants || [];

    for (const variant of variants) {
      const variantId = String(variant.id);
      const variantName = variant.name;
      const fullName = `${productName} - ${variantName}`;
      const hasPreview = variant?.files?.some(f => f.type === "preview");
      const imageFile = variant?.files?.find(f => f.type === "preview");
      const image_url = imageFile?.preview_url || "";

      const expectedMetadata = {
        printful_product_name: productName,
        printful_variant_name: variantName,
        printful_variant_id: variantId,
        color: variant.color || "",
        size: variant.size || "",
        image_url,
        mode,
      };

      const existingProduct = await findStripeProductByName(stripe, fullName);
      if (!existingProduct) continue;

      if (!hasPreview) {
        brokenVariants.push({ variant_id: variantId, name: fullName, product_id: product.id });
        const prices = await stripe.prices.list({ product: existingProduct.id, limit: 100 });
        for (const price of prices.data) {
          if (price.active && !DRY_RUN) {
            await stripe.prices.update(price.id, { active: false });
            console.log(`⛔ Deactivated price: ${price.id} (${fullName})`);
          }
        }
      } else {
        const needsUpdate = Object.entries(expectedMetadata).some(
          ([k, v]) => existingProduct.metadata[k] !== v
        );
        if (needsUpdate && !DRY_RUN) {
          await stripe.products.update(existingProduct.id, { metadata: expectedMetadata });
          console.log(`🔁 Fixed metadata for: ${fullName}`);
        }
      }
    }

    await new Promise((res) => setTimeout(res, delayMs));
  }

  if (brokenVariants.length === 0) {
    console.log(`✅ No broken variants found in ${mode.toUpperCase()}.`);
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