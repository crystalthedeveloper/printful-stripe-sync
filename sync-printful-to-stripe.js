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

  const res = await fetch("https://api.printful.com/store/variants", {
    headers: { Authorization: `Bearer ${PRINTFUL_API_KEY}` },
  });
  const { result: variantList = [] } = await res.json();

  let added = 0, updated = 0, skipped = 0;

  for (const variant of variantList) {
    const variantId = variant?.id;
    if (!variantId) { skipped++; continue; }

    try {
      const detailsRes = await fetch(`https://api.printful.com/store/variants/${variantId}`, {
        headers: { Authorization: `Bearer ${PRINTFUL_API_KEY}` },
      });
      const { result: v } = await detailsRes.json();
      if (!v) { skipped++; continue; }

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
      const files = v.files;
      const image = files?.find(f => f.type === "preview")?.preview_url || "";

      if (!productName || !variantName || !price) { skipped++; continue; }

      const cleanProductName = productName.replace(/^\[SKIPPED\]\s*/, "");
      const title = `${cleanProductName} - ${variantName}`;

      const metadata = {
        printful_product_name: cleanProductName,
        printful_variant_name: variantName,
        printful_variant_id: String(variantId),
        color: v.color || "",
        size: v.size || "",
        image_url: image,
        mode,
      };

      const existing = await stripe.products.search({
        query: `metadata['printful_variant_id']:'${variantId}'`,
      });

      let productId;
      if (existing.data.length > 0) {
        const product = existing.data[0];
        productId = product.id;

        const needsUpdate = Object.entries(metadata).some(([k, v]) => product.metadata[k] !== v);
        if (needsUpdate && !DRY_RUN) {
          await stripe.products.update(productId, {
            metadata,
            name: title,
          });
          updated++;
        } else {
          skipped++;
        }
      } else {
        if (!DRY_RUN) {
          const created = await stripe.products.create({ name: title, metadata });
          productId = created.id;
          added++;
        } else {
          continue;
        }
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
            size: v.size || "",
            color: v.color || "",
            image_url: image,
            printful_store_variant_id: String(variantId),
          },
        });
      }
    } catch (err) {
      skipped++;
      console.error(`❌ Failed to sync variant ${variant?.id}: ${err.message}`);
    }
  }

  console.log(`✅ ${mode.toUpperCase()} SYNC → Added: ${added}, Updated: ${updated}, Skipped: ${skipped}`);
}

async function run() {
  await sync("test");
  await sync("live");
}

run();