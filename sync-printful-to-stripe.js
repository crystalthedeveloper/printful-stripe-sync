// sync-printful-to-stripe.js
// Syncs valid Printful variants to Stripe and stores the mapping in Supabase with mode support

import dotenv from "dotenv";
import Stripe from "stripe";
import fetch from "node-fetch";
dotenv.config();

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_TEST;
const PRINTFUL_API_KEY = process.env.PRINTFUL_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2023-10-16" });
const MODE = STRIPE_SECRET_KEY.startsWith("sk_test") ? "test" : "live";

async function isValidPrintfulVariant(variantId) {
  const res = await fetch(`https://api.printful.com/products/variant/${variantId}`, {
    headers: { Authorization: `Bearer ${PRINTFUL_API_KEY}` }
  });

  if (!res.ok) return false;

  const data = await res.json();
  return !!(data.result?.variant_id && data.result?.files?.length > 0);
}

async function sync() {
  try {
    const res = await fetch("https://api.printful.com/sync/products", {
      headers: { Authorization: `Bearer ${PRINTFUL_API_KEY}` }
    });

    const rawText = await res.text();
    let productData;

    try {
      productData = JSON.parse(rawText);
    } catch (e) {
      throw new Error("❌ Failed to parse Printful response: " + rawText);
    }

    const productList = productData.result;
    if (!productList || !Array.isArray(productList)) {
      console.error("❌ Invalid Printful product list response:", productData);
      throw new Error("No products found from Printful");
    }

    const insertMappings = [];

    for (const product of productList) {
      const detailRes = await fetch(`https://api.printful.com/sync/products/${product.id}`, {
        headers: { Authorization: `Bearer ${PRINTFUL_API_KEY}` }
      });

      const detailRaw = await detailRes.text();
      let detailData;

      try {
        detailData = JSON.parse(detailRaw);
      } catch {
        console.warn(`⚠️ Failed to parse product ${product.id} detail response:`, detailRaw);
        continue;
      }

      const productName = detailData.result?.sync_product?.name;
      const syncVariants = detailData.result?.sync_variants;

      if (!detailRes.ok || !productName || !syncVariants) {
        console.warn(`⚠️ Skipping product ID ${product.id} due to missing data`);
        continue;
      }

      for (const variant of syncVariants) {
        const {
          id: printful_variant_id,
          name: variantName,
          retail_price,
          is_ignored,
          is_deleted
        } = variant;

        if (is_deleted || is_ignored || !(await isValidPrintfulVariant(printful_variant_id))) {
          console.warn(`❌ Skipping invalid or deleted variant ${printful_variant_id}`);
          continue;
        }

        const stripeProduct = await stripe.products.create({
          name: `${productName} - ${variantName}`
        });

        const stripePrice = await stripe.prices.create({
          product: stripeProduct.id,
          unit_amount: Math.round(parseFloat(retail_price) * 100),
          currency: "cad"
        });

        insertMappings.push({
          printful_variant_id: printful_variant_id.toString(),
          stripe_price_id: stripePrice.id,
          retail_price: parseFloat(retail_price),
          mode: MODE
        });

        console.log(`✅ Synced variant ${printful_variant_id} → Stripe price ${stripePrice.id} (${MODE})`);
      }
    }

    if (insertMappings.length === 0) {
      console.warn("⚠️ No valid variants to insert into Supabase.");
      return;
    }

    const supabaseRes = await fetch(`${SUPABASE_URL}/rest/v1/variant_mappings?on_conflict=printful_variant_id,stripe_price_id,mode`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates"
      },
      body: JSON.stringify(insertMappings)
    });

    if (!supabaseRes.ok) {
      const error = await supabaseRes.text();
      throw new Error(`❌ Failed to insert mappings into Supabase: ${error}`);
    }

    console.log(`🎉 Synced ${insertMappings.length} Printful variants to Stripe [${MODE}] and saved to Supabase`);
  } catch (err) {
    console.error("❌ Sync error:", err.message);
    process.exit(1);
  }
}

sync();