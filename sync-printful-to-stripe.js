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

  const res = await fetch("https://api.printful.com/sync/products", {
    headers: { Authorization: `Bearer ${PRINTFUL_API_KEY}` },
  });

  const json = await res.json();
  const productList = json.result || [];

  console.log(`📦 Found ${productList.length} synced Printful products`);

  let added = 0, updated = 0, errored = 0;

  for (const product of productList) {
    const syncProductId = product.id;
    const detailRes = await fetch(`https://api.printful.com/sync/products/${syncProductId}`, {
      headers: { Authorization: `Bearer ${PRINTFUL_API_KEY}` },
    });
    const detailJson = await detailRes.json();
    const item = detailJson.result;
    const productName = item.sync_product.name;
    const variants = item.sync_variants || [];

    console.log(`🧩 ${productName}: ${variants.length} variants`);

    for (const v of variants) {
      const variantId = v.variant_id;
      const variantName = v.name;
      const price = v.retail_price;
      const image = item.sync_product.thumbnail_url;

      // Skip if missing data
      if (!variantId || !productName || !variantName || !price) {
        console.warn(`⚠️ Skipping invalid variant: ${productName} - ${variantName}`);
        continue;
      }

      const title = `${productName.trim()} - ${variantName.trim()}`.trim();
      const metadata = {
        printful_product_name: productName,
        printful_variant_name: variantName,
        printful_variant_id: String(variantId),
        image_url: image,
        mode,
      };

      try {
        const existing = await stripe.products.search({
          query: `metadata['printful_variant_id']:'${variantId}' AND metadata['mode']:'${mode}'`,
        });

        let productId;
        if (existing.data.length > 0) {
          productId = existing.data[0].id;
          if (!DRY_RUN) {
            await stripe.products.update(productId, { name: title, metadata, active: true });
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
              printful_store_variant_id: String(variantId),
              image_url: image,
            },
          });
          console.log(`💰 Price created for ${title}`);
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