// sync-printful-to-stripe.js

import dotenv from "dotenv";
import Stripe from "stripe";
import fetch from "node-fetch";
dotenv.config();

const MODE = process.env.MODE || "test"; // "live" or "test"
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const PRINTFUL_API_KEY = process.env.PRINTFUL_API_KEY;

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2023-10-16" });

async function sync() {
  console.log(`🔄 Syncing Printful variants to Stripe in ${MODE.toUpperCase()} mode...`);

  const productRes = await fetch("https://api.printful.com/sync/products", {
    headers: { Authorization: `Bearer ${PRINTFUL_API_KEY}` },
  });

  const productList = (await productRes.json()).result;

  for (const product of productList) {
    const detailRes = await fetch(`https://api.printful.com/sync/products/${product.id}`, {
      headers: { Authorization: `Bearer ${PRINTFUL_API_KEY}` },
    });
    const detailData = await detailRes.json();

    const productName = detailData.result?.sync_product?.name;
    const syncVariants = detailData.result?.sync_variants;

    if (!productName || !Array.isArray(syncVariants)) continue;

    for (const variant of syncVariants) {
      const {
        id: printful_variant_id,
        name: variantName,
        retail_price,
        is_deleted,
        is_ignored,
        color,
        size,
        files,
      } = variant;

      if (is_deleted || is_ignored) continue;

      const imageFile = files?.find(f => f.type === "preview");
      const image_url = imageFile?.preview_url || "";

      try {
        const stripeProduct = await stripe.products.create({
          name: `${productName} - ${variantName}`,
          metadata: {
            printful_product_name: productName,
            printful_variant_name: variantName,
            printful_variant_id: String(printful_variant_id),
            color: color || "",
            size: size || "",
            image_url,
            mode: MODE,
          },
        });

        const stripePrice = await stripe.prices.create({
          product: stripeProduct.id,
          unit_amount: Math.round(parseFloat(retail_price) * 100),
          currency: "cad",
          metadata: {
            size: size || "",
            color: color || "",
            image_url,
            printful_variant_id: String(printful_variant_id),
          },
        });

        console.log(`✅ Synced ${variantName} → Stripe price ID: ${stripePrice.id}`);
      } catch (err) {
        console.error(`❌ Stripe error for ${variantName}:`, err.message);
      }
    }
  }

  console.log("🎉 Sync complete");
}

sync();