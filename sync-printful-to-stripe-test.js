// sync-printful-to-stripe-test.js
// Syncs Printful variants to Stripe Sandbox and Supabase (test mode)

import dotenv from "dotenv";
import Stripe from "stripe";
import fetch from "node-fetch";
dotenv.config();

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const PRINTFUL_API_KEY = process.env.PRINTFUL_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DRY_RUN = process.env.DRY_RUN === "true";
const MODE = "test";

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2023-10-16" });

// ✅ Get preview image from sync product
async function getPrintfulImageURLFromProduct(productId, variantId) {
  try {
    const res = await fetch(`https://api.printful.com/sync/products/${productId}`, {
      headers: { Authorization: `Bearer ${PRINTFUL_API_KEY}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const variant = data.result?.sync_variants?.find(v => v.id === variantId);
    const image = variant?.files?.find(f => f.type === "preview");
    return image?.preview_url || null;
  } catch (err) {
    console.warn(`⚠️ Could not fetch image for variant ${variantId}: ${err.message}`);
    return null;
  }
}

// ✅ Validate variant using sync product API
async function isValidPrintfulVariant(variantId, productId) {
  try {
    const res = await fetch(`https://api.printful.com/sync/products/${productId}`, {
      headers: { Authorization: `Bearer ${PRINTFUL_API_KEY}` },
    });
    if (!res.ok) return false;
    const data = await res.json();
    const variant = data.result?.sync_variants?.find(v => v.id === variantId);
    const preview = variant?.files?.find(f => f.type === "preview");
    return !!(variant?.id && preview?.preview_url);
  } catch {
    return false;
  }
}

async function variantExistsInSupabase(variantId, mode) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/variant_mappings?select=id&printful_variant_id=eq.${variantId}&mode=eq.${mode}`, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!res.ok) return false;
  const data = await res.json();
  return data.length > 0;
}

async function sync() {
  console.log("🔄 Syncing to Stripe TEST & Supabase test mode...");

  const productRes = await fetch("https://api.printful.com/sync/products", {
    headers: { Authorization: `Bearer ${PRINTFUL_API_KEY}` },
  });
  const productList = (await productRes.json()).result;
  const insertMappings = [];

  for (const product of productList) {
    const detailRes = await fetch(`https://api.printful.com/sync/products/${product.id}`, {
      headers: { Authorization: `Bearer ${PRINTFUL_API_KEY}` },
    });
    const detailData = await detailRes.json();
    const productName = detailData.result?.sync_product?.name;
    const syncVariants = detailData.result?.sync_variants;
    if (!productName || !Array.isArray(syncVariants)) continue;

    for (const variant of syncVariants) {
      const { id: printful_variant_id, name: variantName, retail_price, is_ignored, is_deleted, options } = variant;
      console.log(`🔍 Checking variant ${variantName} (${printful_variant_id})`);

      if (is_deleted || is_ignored) {
        console.log(`🚫 Skipped ${printful_variant_id} - deleted or ignored`);
        continue;
      }

      const valid = await isValidPrintfulVariant(printful_variant_id, product.id);
      if (!valid) {
        console.log(`🚫 Skipped ${printful_variant_id} - 404 or missing preview image`);
        continue;
      }

      const exists = await variantExistsInSupabase(printful_variant_id, MODE);
      if (exists) {
        console.log(`⚠️ Skipped ${printful_variant_id} - already exists in Supabase`);
        continue;
      }

      let stripeProduct, stripePrice;
      try {
        stripeProduct = await stripe.products.create({
          name: `${productName} - ${variantName}`,
        });
        stripePrice = await stripe.prices.create({
          product: stripeProduct.id,
          unit_amount: Math.round(parseFloat(retail_price) * 100),
          currency: "cad",
        });
      } catch (err) {
        console.error(`❌ Stripe error for ${printful_variant_id}: ${err.message}`);
        continue;
      }

      const imageUrl = await getPrintfulImageURLFromProduct(product.id, printful_variant_id);
      const color = options?.find(o => o.id === "color")?.value || "";
      const size = options?.find(o => o.id === "size")?.value || "";

      insertMappings.push({
        printful_variant_id: printful_variant_id.toString(),
        stripe_price_id: stripePrice.id,
        retail_price: parseFloat(retail_price),
        image_url: imageUrl,
        color,
        size,
        variant_name: variantName,
        mode: MODE,
        created_at: new Date().toISOString(),
      });

      console.log(`✅ Synced ${variantName} → Stripe TEST price ${stripePrice.id}`);
    }
  }

  if (insertMappings.length === 0) {
    console.warn("⚠️ No valid variants to insert into Supabase.");
    return;
  }

  if (DRY_RUN) {
    console.log("🧪 DRY RUN enabled — skipping Supabase insert.");
    console.table(insertMappings.map(v => ({
      variant: v.variant_name,
      stripe_price_id: v.stripe_price_id,
      price: v.retail_price,
      image_url: v.image_url,
    })));
    return;
  }

  try {
    console.log("📦 Inserting into Supabase...");
    const supabaseRes = await fetch(`${SUPABASE_URL}/rest/v1/variant_mappings`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(insertMappings),
    });
    const supabaseText = await supabaseRes.text();
    if (!supabaseRes.ok) {
      throw new Error(`❌ Failed to insert into Supabase: ${supabaseText}`);
    }
    console.log(`🎉 Synced ${insertMappings.length} variants to Supabase (test mode)`);
  } catch (err) {
    console.error("❌ Supabase insert failed:", err.message);
  }
}

sync();