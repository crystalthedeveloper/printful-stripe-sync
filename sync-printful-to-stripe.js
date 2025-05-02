// sync-printful-to-stripe.js

import dotenv from "dotenv";
import Stripe from "stripe";
import fetch from "node-fetch";
dotenv.config();

const DRY_RUN = process.env.DRY_RUN === "true";
const PRINTFUL_API_KEY = process.env.PRINTFUL_API_KEY;
const STRIPE_KEYS = {
  test: process.env.STRIPE_SECRET_TEST,
  live: process.env.STRIPE_SECRET_KEY,
};

if (!PRINTFUL_API_KEY || !STRIPE_KEYS.test || !STRIPE_KEYS.live) {
  throw new Error("❌ Missing API keys in environment.");
}

async function sync(mode) {
  const stripe = new Stripe(STRIPE_KEYS[mode], { apiVersion: "2023-10-16" });
  console.log(`🔄 Syncing Printful variants to Stripe in ${mode.toUpperCase()} mode...`);
  if (DRY_RUN) console.log("🚧 DRY_RUN is enabled. No changes will be made to Stripe.");

  const res = await fetch("https://api.printful.com/store/variants", {
    headers: { Authorization: `Bearer ${PRINTFUL_API_KEY}` },
  });

  const { result: variantList = [] } = await res.json();

  for (const variant of variantList) {
    try {
      const variantId = variant.id;
      const variantDetailsRes = await fetch(`https://api.printful.com/store/variants/${variantId}`, {
        headers: { Authorization: `Bearer ${PRINTFUL_API_KEY}` },
      });

      const variantData = await variantDetailsRes.json();
      const v = variantData.result;

      if (!v?.name || !v?.product?.name || !v?.retail_price) {
        console.warn(`⚠️ Skipping variant ${variantId} due to missing name, product, or price`);
        continue;
      }

      const productName = v.product.name;
      const variantName = v.name;
      const retail_price = v.retail_price;
      const printful_variant_id = v.id;
      const color = v.color;
      const size = v.size;
      const files = v.files;

      const imageFile = files?.find(f => f.type === "preview");
      const image_url = imageFile?.preview_url || "";

      const expectedMetadata = {
        printful_product_name: productName,
        printful_variant_name: variantName,
        printful_variant_id: String(printful_variant_id),
        color: color || "",
        size: size || "",
        image_url,
        mode,
      };

      const existingProducts = await stripe.products.search({
        query: `name:"${productName} - ${variantName}"`,
      });

      if (existingProducts.data.length > 0) {
        const existingProduct = existingProducts.data[0];

        const needsMetaUpdate = Object.entries(expectedMetadata).some(
          ([k, v]) => existingProduct.metadata[k] !== v
        );

        if (needsMetaUpdate && !DRY_RUN) {
          await stripe.products.update(existingProduct.id, { metadata: expectedMetadata });
          console.log(`🔄 Updated product metadata: ${variantName} (${mode})`);
        }

        const prices = await stripe.prices.list({ product: existingProduct.id, limit: 10 });
        const price = prices.data.find(p => !p.deleted);

        const hasCorrectMeta = price?.metadata?.printful_store_variant_id === String(printful_variant_id);

        if (!hasCorrectMeta && price && !DRY_RUN) {
          await stripe.prices.update(price.id, {
            metadata: {
              ...price.metadata,
              printful_store_variant_id: String(printful_variant_id),
            },
          });
          console.log(`🔄 Updated price metadata: ${variantName} (${mode})`);
        }

        if (DRY_RUN) console.log(`🧪 Would update existing: ${variantName} (${mode})`);
      } else {
        if (!DRY_RUN) {
          const newProduct = await stripe.products.create({
            name: `${productName} - ${variantName}`,
            metadata: expectedMetadata,
          });

          const newPrice = await stripe.prices.create({
            product: newProduct.id,
            unit_amount: Math.round(parseFloat(retail_price) * 100),
            currency: "cad",
            metadata: {
              size: size || "",
              color: color || "",
              image_url,
              printful_store_variant_id: String(printful_variant_id),
            },
          });

          console.log(`✅ Created new: ${variantName} → ${newPrice.id} (${mode})`);
        } else {
          console.log(`🧪 Would create new: ${variantName} (${mode})`);
        }
      }
    } catch (err) {
      console.error(`❌ Error syncing variant (${mode}):`, err.message);
    }
  }

  console.log(`✅ Sync complete for ${mode.toUpperCase()}`);
}

async function run() {
  await sync("test");
  await sync("live");
}

run();