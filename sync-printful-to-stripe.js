// sync-printful-to-stripe.js
// Syncs all Printful variants to Stripe and stores their mapping in Supabase

import dotenv from "dotenv";
import Stripe from "stripe";
import fetch from "node-fetch";
dotenv.config();

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const PRINTFUL_API_KEY = process.env.PRINTFUL_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2023-10-16" });

async function sync() {
  try {
    // Step 1: Fetch all sync products from Printful
    const res = await fetch("https://api.printful.com/sync/products", {
      headers: { Authorization: `Bearer ${PRINTFUL_API_KEY}` }
    });

    const { result } = await res.json();
    if (!result) throw new Error("No products found from Printful");

    const insertMappings = [];

    for (const product of result) {
      const detailRes = await fetch(`https://api.printful.com/sync/products/${product.id}`, {
        headers: { Authorization: `Bearer ${PRINTFUL_API_KEY}` }
      });

      const productData = await detailRes.json();
      const { name } = productData.result.sync_product;
      const { sync_variants } = productData.result;

      for (const variant of sync_variants) {
        const { id: printful_variant_id, name: variantName, retail_price } = variant;

        const stripeProduct = await stripe.products.create({
          name: `${name} - ${variantName}`
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
      }
    }

    // Step 2: Insert mappings into Supabase
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
      throw new Error(`Failed to insert variant mappings into Supabase: ${error}`);
    }

    console.log("✅ Synced all Printful variants to Stripe and stored mappings in Supabase");
  } catch (err) {
    console.error("❌ Error during sync:", err.message);
    process.exit(1);
  }
}

sync();