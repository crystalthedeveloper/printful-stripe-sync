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
  console.log(`🔄 Syncing Printful → Stripe in ${mode.toUpperCase()} mode...`);

  const productListRes = await fetch("https://api.printful.com/store/products", {
    headers: { Authorization: `Bearer ${PRINTFUL_API_KEY}` },
  });

  const productListJson = await productListRes.json();

  if (!Array.isArray(productListJson.result)) {
    console.error("❌ Failed to fetch product list from Printful.");
    console.log("🔎 Full response:", JSON.stringify(productListJson, null, 2));
    return;
  }

  const productList = productListJson.result;
  console.log(`📦 Found ${productList.length} products in Printful store.`);

  let added = 0, updated = 0, errored = 0;

  for (const product of productList) {
    const productId = product.id;
    console.log(`🔍 Fetching details for product ID ${productId} (${product.name})`);

    const detailRes = await fetch(`https://api.printful.com/store/products/${productId}`, {
      headers: { Authorization: `Bearer ${PRINTFUL_API_KEY}` },
    });

    const detailJson = await detailRes.json();
    const variants = detailJson.result?.variants || [];

    console.log(`🧩 Found ${variants.length} variants for "${product.name}"`);

    for (const variant of variants) {
      const variantId = variant.id;
      const productName = detailJson.result.name;
      const variantName = variant.name;
      const price = variant.retail_price;
      const image = variant.files?.find(f => f.type === "preview")?.preview_url || "";

      // ✅ Skip out-of-stock variants
      const isOutOfStock = variant.is_available === false || variant.stock_status === "out";

      if (isOutOfStock) {
        console.log(`⛔ Skipping out-of-stock variant: ${productName} - ${variantName}`);
        continue;
      }

      if (!variantId || !productName || !variantName || !price) {
        console.warn(`⚠️ Skipping invalid variant in product ${productName}`, {
          variantId, productName, variantName, price
        });
        continue;
      }

      const title = `${productName.trim()} - ${variantName.trim()}`.trim();
      const metadata = {
        printful_product_name: productName,
        printful_variant_name: variantName,
        printful_variant_id: String(variantId),
        color: variant.color || "",
        size: variant.size || "",
        image_url: image,
        mode,
      };

      try {
        console.log(`🔎 Searching Stripe for variant ID ${variantId} with mode=${mode}`);
        const existing = await stripe.products.search({
          query: `metadata['printful_variant_id']:'${variantId}' AND metadata['mode']:'${mode}'`,
        });

        console.log(`🧪 Found ${existing.data.length} matching products in Stripe`);

        let productId;
        if (existing.data.length > 0) {
          productId = existing.data[0].id;
          if (!DRY_RUN) {
            await stripe.products.update(productId, {
              name: title,
              metadata,
              active: true,
            });
          }
          updated++;
          console.log(`🔁 Updated: ${title}`);
        } else {
          if (!DRY_RUN) {
            const created = await stripe.products.create({
              name: title,
              metadata,
              active: true,
            });
            productId = created.id;
          }
          added++;
          console.log(`➕ Created: ${title}`);
        }

        const prices = await stripe.prices.list({ product: productId, limit: 100 });
        const hasPrice = prices.data.some(p =>
          p.metadata?.printful_store_variant_id === String(variantId)
        );

        if (!hasPrice && !DRY_RUN) {
          await stripe.prices.create({
            product: productId,
            unit_amount: Math.round(parseFloat(price) * 100),
            currency: "cad",
            metadata: {
              size: variant.size || "",
              color: variant.color || "",
              image_url: image,
              printful_store_variant_id: String(variantId),
            },
          });
          console.log(`💰 Price created for ${title}`);
        } else {
          console.log(`✅ Price already exists for variant ${variantId}`);
        }

      } catch (err) {
        errored++;
        console.error(`❌ Error syncing variant ${variantId}: ${err.message}`);
      }
    }
  }

  console.log(`✅ ${mode.toUpperCase()} SYNC COMPLETE → Added: ${added}, Updated: ${updated}, Errors: ${errored}`);
}

async function run() {
  await sync("test");
  await sync("live");
}

run();