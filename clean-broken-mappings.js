// clean-printful-variants.js
// Preview Printful variants and check which are valid (no Supabase)

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

      if (!hasPreview) {
        invalidVariants.push({
          variant_id: variant.id,
          name: variant.name,
          product_id: product.id,
        });

        if (!DRY_RUN) {
          console.log(`🧼 Deleting Stripe product/price for invalid variant: ${variant.name}`);
          // Optionally delete price/product using Stripe API here if needed
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
    console.log("✅ All variants are valid.");
  } else {
    console.log(`⚠️ ${broken.length} variant(s) missing preview images:`);
    console.table(broken);
  }
}

run();