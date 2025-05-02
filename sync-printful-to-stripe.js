// sync-printful-to-stripe.js

import dotenv from "dotenv";
import Stripe from "stripe";
import fetch from "node-fetch";
dotenv.config();

const MODE = process.env.MODE || "test"; // "live" or "test"
const DRY_RUN = process.env.DRY_RUN === "true";
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const PRINTFUL_API_KEY = process.env.PRINTFUL_API_KEY;

if (!STRIPE_SECRET_KEY || !PRINTFUL_API_KEY) {
  throw new Error("❌ Missing STRIPE_SECRET_KEY or PRINTFUL_API_KEY in environment.");
}

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2023-10-16" });

async function sync() {
  console.log(`🔄 Syncing Printful variants to Stripe in ${MODE.toUpperCase()} mode...`);
  if (DRY_RUN) console.log("🚧 DRY_RUN is enabled. No changes will be made to Stripe.");

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

      // Skip broken or non-sellable variants
      if (is_deleted || is_ignored) continue;
      if (!retail_price || !printful_variant_id) {
        console.warn(`⚠️ Skipping variant "${variantName}" due to missing retail_price or variant ID`);
        continue;
      }

      const imageFile = files?.find(f => f.type === "preview");
      const image_url = imageFile?.preview_url || "";

      try {
        const stripeProductPayload = {
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
        };

        const stripePricePayload = {
          unit_amount: Math.round(parseFloat(retail_price) * 100),
          currency: "cad",
          metadata: {
            size: size || "",
            color: color || "",
            image_url,
            printful_store_variant_id: String(printful_variant_id), // ✅ Needed for webhook
          },
        };

        if (DRY_RUN) {
          console.log(`🧪 Would sync: ${variantName}`);
          console.log("🔍 Product metadata:", stripeProductPayload.metadata);
          console.log("🔍 Price metadata:", stripePricePayload.metadata);
        } else {
          const stripeProduct = await stripe.products.create(stripeProductPayload);
          const stripePrice = await stripe.prices.create({
            ...stripePricePayload,
            product: stripeProduct.id,
          });

          console.log(`✅ Synced: ${variantName} → Stripe price ID: ${stripePrice.id}`);
        }
      } catch (err) {
        console.error(`❌ Failed for variant "${variantName}":`, err.message);
      }
    }
  }

  console.log("🎉 Sync complete");
}

sync();