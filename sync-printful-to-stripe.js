// sync-printful-to-stripe.js
import dotenv from "dotenv";
import Stripe from "stripe";
import fetch from "node-fetch";
dotenv.config();

const DRY_RUN = process.env.DRY_RUN === "true";
const PRINTFUL_API_KEY = process.env.PRINTFUL_API_KEY;
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;

if (!PRINTFUL_API_KEY || !STRIPE_KEY) {
  throw new Error("❌ Missing API keys in environment.");
}

const stripe = new Stripe(STRIPE_KEY, { apiVersion: "2023-10-16" });

async function sync() {
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

      if (!variantId || !productName || !variantName || !price) {
        console.warn(`⚠️ Skipping invalid variant: ${productName} - ${variantName}`);
        continue;
      }

      const title = `${productName.trim()} - ${variantName.trim()}`;
      const metadata = {
        printful_product_name: productName,
        printful_variant_name: variantName,
        printful_variant_id: String(variantId),
        image_url: image,
        printful_sync_product_id: String(syncProductId),
      };

      try {
        const existing = await stripe.products.search({
          query: `metadata['printful_variant_id']:'${variantId}'`,
        });

        let keeperId;

        if (existing.data.length > 0) {
          keeperId = existing.data[0].id;
          if (!DRY_RUN) {
            await stripe.products.update(keeperId, {
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
            keeperId = created.id;
          }
          added++;
          console.log(`➕ Created: ${title}`);
        }

        const prices = await stripe.prices.list({ product: keeperId, limit: 100 });
        const hasPrice = prices.data.some(p =>
          p.metadata?.printful_store_variant_id === String(variantId)
        );

        if (!hasPrice && !DRY_RUN) {
          await stripe.prices.create({
            product: keeperId,
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

  console.log(`✅ SYNC COMPLETE → Added: ${added}, Updated: ${updated}, Errors: ${errored}`);
}

sync();