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
  console.log(`🔄 Force syncing Printful variants to Stripe in ${mode.toUpperCase()} mode...`);

  const res = await fetch("https://api.printful.com/store/variants", {
    headers: { Authorization: `Bearer ${PRINTFUL_API_KEY}` },
  });

  const { result: variantList = [] } = await res.json();

  console.log(`📦 Fetched ${variantList.length} variants`);

  let added = 0, updated = 0, errored = 0;

  for (const variantSummary of variantList) {
    const variantId = variantSummary?.id || variantSummary?.variant_id;

    if (!variantId) {
      console.warn("⚠️ Skipping variant with missing ID:", JSON.stringify(variantSummary, null, 2));
      continue;
    }

    try {
      const detailsRes = await fetch(`https://api.printful.com/store/variants/${variantId}`, {
        headers: { Authorization: `Bearer ${PRINTFUL_API_KEY}` },
      });

      const { result: v } = await detailsRes.json();
      if (!v) {
        console.warn(`⚠️ Skipping variant ${variantId} — no detail data`);
        continue;
      }

      let productName = v.product?.name;
      if (!productName && v?.product_id) {
        const productRes = await fetch(`https://api.printful.com/store/products/${v.product_id}`, {
          headers: { Authorization: `Bearer ${PRINTFUL_API_KEY}` },
        });
        const productJson = await productRes.json();
        productName = productJson.result?.name;
      }

      const variantName = v.name;
      const price = v.retail_price;
      const image = v.files?.find(f => f.type === "preview")?.preview_url || "";

      if (!productName || !variantName || !price) {
        console.warn(`⚠️ Skipping incomplete variant ${variantId} — missing name, price, or image`);
        continue;
      }

      const title = `${productName.trim()} - ${variantName.trim()}`.trim();
      const metadata = {
        printful_product_name: productName,
        printful_variant_name: variantName,
        printful_variant_id: String(variantId),
        color: v.color || "",
        size: v.size || "",
        image_url: image,
        mode,
      };

      console.log(`🔍 Searching Stripe for variant ID ${variantId}...`);

      const existing = await stripe.products.search({
        query: `metadata['printful_variant_id']:'${variantId}'`,
      });

      let productId;
      if (existing.data.length > 0) {
        const product = existing.data[0];
        productId = product.id;
        console.log(`✅ Found existing product ${product.name} (${productId})`);

        if (!DRY_RUN) {
          await stripe.products.update(productId, {
            name: title,
            metadata,
            active: true,
          });
        }

        console.log(`🔁 Updated product ${productId}`);
        updated++;
      } else {
        console.log(`➕ Creating new product: ${title}`);
        if (!DRY_RUN) {
          const created = await stripe.products.create({
            name: title,
            metadata,
            active: true,
          });
          productId = created.id;
        }
        added++;
      }

      // Check existing prices
      const prices = await stripe.prices.list({ product: productId, limit: 100 });
      const hasPrice = prices.data.some(p =>
        p.metadata?.printful_store_variant_id === String(variantId)
      );

      if (!hasPrice && !DRY_RUN) {
        console.log(`💰 Creating price for ${title} ($${price} CAD)`);
        await stripe.prices.create({
          product: productId,
          unit_amount: Math.round(parseFloat(price) * 100),
          currency: "cad",
          metadata: {
            size: v.size || "",
            color: v.color || "",
            image_url: image,
            printful_store_variant_id: String(variantId),
          },
        });
      } else {
        console.log(`✅ Price already exists for ${variantId}`);
      }

    } catch (err) {
      errored++;
      console.error(`❌ Error syncing variant ${variantSummary.id || "[unknown]"}: ${err.message}`);
    }
  }

  console.log(`✅ ${mode.toUpperCase()} SYNC COMPLETE → Added: ${added}, Updated: ${updated}, Errors: ${errored}`);
}

async function run() {
  await sync("test");
  await sync("live");
}

run();