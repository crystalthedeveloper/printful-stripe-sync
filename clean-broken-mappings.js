// clean-printful-variants.js
// Scan Printful variants for missing preview images and optionally clean from Stripe

import dotenv from "dotenv";
import Stripe from "stripe";
import fetch from "node-fetch";
dotenv.config();

const PRINTFUL_API_KEY = process.env.PRINTFUL_API_KEY;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const DRY_RUN = process.env.DRY_RUN === "true";
const delayMs = 200;

if (!PRINTFUL_API_KEY || !STRIPE_SECRET_KEY) {
  throw new Error("❌ Missing PRINTFUL_API_KEY or STRIPE_SECRET_KEY in environment.");
}

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2023-10-16" });

async function getPrintfulVariants() {
  const productRes = await fetch("https://api.printful.com/sync/products", {
    headers: { Authorization: `Bearer ${PRINTFUL_API_KEY}` },
  });

  const productList = (await productRes.json()).result;
  const invalidVariants = [];

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
        invalidVariants.push({
          variant_id: variantId,
          name: variantName,
          product_id: product.id,
        });

        console.warn(`⚠️ Missing preview for variant: ${variantName} (ID: ${variantId})`);

        if (!DRY_RUN) {
          try {
            // Find and delete Stripe price with metadata.match
            const prices = await stripe.prices.list({ limit: 100 });
            const matching = prices.data.find(p =>
              p.metadata?.printful_store_variant_id === variantId
            );

            if (matching) {
              await stripe.prices.update(matching.id, { active: false });
              console.log(`🗑️  Deactivated Stripe price: ${matching.id}`);
            }
          } catch (err) {
            console.error(`❌ Failed to deactivate Stripe price for variant "${variantName}":`, err.message);
          }
        }
      }
    }

    await new Promise(res => setTimeout(res, delayMs));
  }

  return invalidVariants;
}

async function run() {
  console.log("🔍 Scanning Printful variants for missing preview images...");

  const broken = await getPrintfulVariants();

  if (!broken.length) {
    console.log("✅ All variants have preview images.");
  } else {
    console.log(`⚠️ Found ${broken.length} variant(s) missing preview images:`);
    console.table(broken);
  }
}

run();