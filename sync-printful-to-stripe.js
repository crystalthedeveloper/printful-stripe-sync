// sync-printful-to-stripe.js
// Syncs valid Printful variants to Stripe and stores the mapping in Supabase

import dotenv from "dotenv";
import Stripe from "stripe";
import fetch from "node-fetch";
dotenv.config();

const STRIPE_SECRET_TEST = process.env.STRIPE_SECRET_TEST;
const PRINTFUL_API_KEY = process.env.PRINTFUL_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const stripe = new Stripe(STRIPE_SECRET_TEST, { apiVersion: "2023-10-16" });

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

    const { result: productList } = await res.json();
    if (!productList || !Array.isArray(productList)) {
      throw new Error("No products found from Printful");
    }

    const insertMappings = [];

    for (const product of productList) {
      const detailRes = await fetch(`https://api.printful.com/sync/products/${product.id}`, {
        headers: { Authorization: `Bearer ${PRINTFUL_API_KEY}` }
      });

      const productData = await detailRes.json();

      const productName = productData.result?.sync_product?.name;
      const syncVariants = productData.result?.sync_variants;

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
          retail_price: parseFloat(retail_price)
        });

        console.log(`✅ Synced variant ${printful_variant_id} → Stripe price ${stripePrice.id}`);
      }
    }

    if (insertMappings.length === 0) {
      console.warn("⚠️ No valid variants to insert into Supabase.");
      return;
    }

    const supabaseRes = await fetch(`${SUPABASE_URL}/rest/v1/variant_mappings?on_conflict=printful_variant_id`, {
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

    console.log("🎉 Successfully synced Printful variants to Stripe and Supabase");
  } catch (err) {
    console.error("❌ Sync error:", err.message);
    process.exit(1);
  }
}

sync();