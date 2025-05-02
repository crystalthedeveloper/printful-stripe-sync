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
    const variantId = variant?.id;
    if (!variantId) {
      console.warn("⚠️ Skipping variant with missing ID.");
      continue;
    }
  
    try {
      const variantDetailsRes = await fetch(`https://api.printful.com/store/variants/${variantId}`, {
        headers: { Authorization: `Bearer ${PRINTFUL_API_KEY}` },
      });
  
      const variantData = await variantDetailsRes.json();
      const v = variantData.result;
  
      if (!v) {
        console.warn(`⚠️ Skipping variant ${variantId}: No result returned from Printful API.`);
        continue;
      }
  
      let productName = v.product?.name;
      const variantName = v.name;
      const retail_price = v.retail_price;
      const printful_variant_id = v.id;
      const color = v.color;
      const size = v.size;
      const files = v.files;
  
      // Fallback to fetch product name if not present
      if (!productName && v.product_id) {
        const productRes = await fetch(`https://api.printful.com/store/products/${v.product_id}`, {
          headers: { Authorization: `Bearer ${PRINTFUL_API_KEY}` },
        });
        const productJson = await productRes.json();
        productName = productJson.result?.name;
      }
  
      if (!productName || !variantName || !retail_price) {
        console.warn(`⚠️ Skipping variant ${printful_variant_id} due to missing name, product, or price`);
        continue;
      }

      const imageFile = files?.find(f => f.type === "preview");
      const image_url = imageFile?.preview_url || "";

      const expectedMetadata = {
        printful_product_name: resolvedProductName,
        printful_variant_name: variantName,
        printful_variant_id: String(printful_variant_id),
        color: color || "",
        size: size || "",
        image_url,
        mode,
      };

      const productTitle = `${resolvedProductName} - ${variantName}`;

      const existingProducts = await stripe.products.search({
        query: `name:"${productTitle}"`,
      });

      let stripeProductId;

      if (existingProducts.data.length > 0) {
        const existingProduct = existingProducts.data[0];
        stripeProductId = existingProduct.id;

        const needsMetaUpdate = Object.entries(expectedMetadata).some(
          ([k, v]) => existingProduct.metadata[k] !== v
        );

        if (needsMetaUpdate && !DRY_RUN) {
          await stripe.products.update(existingProduct.id, { metadata: expectedMetadata });
          console.log(`🔄 Updated product metadata: ${variantName} (${mode})`);
        }
      } else {
        if (!DRY_RUN) {
          const newProduct = await stripe.products.create({
            name: productTitle,
            metadata: expectedMetadata,
          });
          stripeProductId = newProduct.id;
          console.log(`✅ Created new product: ${productTitle} (${mode})`);
        } else {
          console.log(`🧪 Would create product: ${productTitle} (${mode})`);
          continue;
        }
      }

      const existingPrices = await stripe.prices.list({ product: stripeProductId, limit: 100 });
      const hasMatchingPrice = existingPrices.data.some((p) =>
        p.metadata?.printful_store_variant_id === String(printful_variant_id)
      );

      if (!hasMatchingPrice && !DRY_RUN) {
        await stripe.prices.create({
          product: stripeProductId,
          unit_amount: Math.round(parseFloat(retail_price) * 100),
          currency: "cad",
          metadata: {
            size: size || "",
            color: color || "",
            image_url,
            printful_store_variant_id: String(printful_variant_id),
          },
        });
        console.log(`✅ Added price for: ${variantName} (${mode})`);
      } else if (!hasMatchingPrice) {
        console.log(`🧪 Would create price for: ${variantName} (${mode})`);
      }

    } catch (err) {
      console.error(`❌ Error syncing variant (${mode}): ${err.message}`);
    }
  }

  console.log(`✅ Sync complete for ${mode.toUpperCase()}`);
}

async function run() {
  await sync("test");
  await sync("live");
}

run();