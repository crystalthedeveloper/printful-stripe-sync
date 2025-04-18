// sync-printful-to-stripe.js
// Syncs live Printful variants to Stripe and Supabase with full metadata (image optional)

import dotenv from "dotenv";
import Stripe from "stripe";
import fetch from "node-fetch";
dotenv.config();

// ENV setup
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const PRINTFUL_API_KEY = process.env.PRINTFUL_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DRY_RUN = process.env.DRY_RUN === "true"; // optional dry run mode

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2023-10-16" });
const MODE = "live";

// Gets the main image URL from Printful store variant
async function getPrintfulImageURL(variantId) {
  try {
    const res = await fetch(`https://api.printful.com/store/variants/${variantId}`, {
      headers: { Authorization: `Bearer ${PRINTFUL_API_KEY}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.result?.files?.[0]?.preview_url || null;
  } catch (err) {
    console.warn(`⚠️ Failed to get image for ${variantId}: ${err.message}`);
    return null;
  }
}

// Validates a Printful store variant (exists)
async function isValidPrintfulVariant(variantId) {
  try {
    const res = await fetch(`https://api.printful.com/store/variants/${variantId}`, {
      headers: { Authorization: `Bearer ${PRINTFUL_API_KEY}` },
    });

    if (!res.ok || res.status === 404) return false;

    const data = await res.json();
    return !!data.result?.id;
  } catch {
    return false;
  }
}

// Main sync function
async function sync() {
  console.log("🔄 Starting Printful to Stripe & Supabase sync...");

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
      const {
        id: printful_variant_id,
        name: variantName,
        retail_price,
        is_ignored,
        is_deleted,
        options,
      } = variant;

      console.log(`🔍 Checking variant ${variantName} (${printful_variant_id})`);

      if (is_deleted || is_ignored) {
        console.log(`🚫 Skipped ${printful_variant_id} - deleted or ignored`);
        continue;
      }

      const valid = await isValidPrintfulVariant(printful_variant_id);
      if (!valid) {
        console.log(`🚫 Skipped ${printful_variant_id} - 404 or invalid`);
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
        console.error(`❌ Stripe error for variant ${printful_variant_id}:`, err.message);
        continue;
      }

      const imageUrl = await getPrintfulImageURL(printful_variant_id);
      if (!imageUrl) console.warn(`⚠️ No image found for ${printful_variant_id}`);

      const color = options?.find((o) => o.id === "color")?.value || "";
      const size = options?.find((o) => o.id === "size")?.value || "";

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

      console.log(`✅ Synced ${variantName} → Stripe price ${stripePrice.id}`);
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
      price: v.retail_price
    })));
    return;
  }

  try {
    console.log("📦 Inserting into Supabase:", JSON.stringify(insertMappings, null, 2));

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
    console.log("📝 Supabase response:", supabaseText);

    if (!supabaseRes.ok) {
      throw new Error(`❌ Failed to insert into Supabase: ${supabaseText}`);
    }

    console.log(`🎉 Synced ${insertMappings.length} variants into Supabase successfully`);
  } catch (err) {
    console.error("❌ Supabase insert failed:", err.message);
  }
}

sync();