// sync-printful-to-stripe.js

import dotenv from "dotenv";
import Stripe from "stripe";
import fetch from "node-fetch";
dotenv.config();

const MODE = process.env.MODE || "test";
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

      if (is_deleted || is_ignored || !retail_price || !printful_variant_id) {
        console.warn(`⚠️ Skipping variant "${variantName}" due to missing data`);
        continue;
      }

      const imageFile = files?.find(f => f.type === "preview");
      const image_url = imageFile?.preview_url || "";

      const expectedMetadata = {
        printful_product_name: productName,
        printful_variant_name: variantName,
        printful_variant_id: String(printful_variant_id),
        color: color || "",
        size: size || "",
        image_url,
        mode: MODE,
      };

      try {
        // Try to find existing Stripe product by name
        const existingProducts = await stripe.products.search({
          query: `name:"${productName} - ${variantName}"`,
        });

        if (existingProducts.data.length > 0) {
          const existingProduct = existingProducts.data[0];

          // Update product metadata if missing
          const missingMetadata = Object.entries(expectedMetadata).some(
            ([key, val]) => existingProduct.metadata[key] !== val
          );

          if (missingMetadata && !DRY_RUN) {
            await stripe.products.update(existingProduct.id, { metadata: expectedMetadata });
            console.log(`🔄 Updated product metadata for: ${variantName}`);
          }

          // Find price and check metadata
          const prices = await stripe.prices.list({ product: existingProduct.id, limit: 10 });
          const existingPrice = prices.data.find(p => !p.deleted);

          const hasCorrectMeta = existingPrice?.metadata?.printful_store_variant_id === String(printful_variant_id);

          if (!hasCorrectMeta && !DRY_RUN) {
            await stripe.prices.update(existingPrice.id, {
              metadata: {
                ...existingPrice.metadata,
                printful_store_variant_id: String(printful_variant_id),
              },
            });
            console.log(`🔄 Updated price metadata for: ${variantName}`);
          }

          if (DRY_RUN) {
            console.log(`🧪 Would update metadata for: ${variantName}`);
          }
        } else {
          // Create new product + price
          if (!DRY_RUN) {
            const stripeProduct = await stripe.products.create({
              name: `${productName} - ${variantName}`,
              metadata: expectedMetadata,
            });

            const stripePrice = await stripe.prices.create({
              product: stripeProduct.id,
              unit_amount: Math.round(parseFloat(retail_price) * 100),
              currency: "cad",
              metadata: {
                size: size || "",
                color: color || "",
                image_url,
                printful_store_variant_id: String(printful_variant_id),
              },
            });

            console.log(`✅ Synced new: ${variantName} → ${stripePrice.id}`);
          } else {
            console.log(`🧪 Would create product + price for: ${variantName}`);
          }
        }
      } catch (err) {
        console.error(`❌ Error syncing ${variantName}:`, err.message);
      }
    }
  }

  console.log("🎉 Sync complete");
}

sync();