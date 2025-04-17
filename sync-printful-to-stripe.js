// sync-printful-to-stripe.js
// Syncs valid Printful variants to Stripe and stores the mapping in Supabase with full metadata

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

async function getPrintfulImageURL(variantId) {
  const res = await fetch(`https://api.printful.com/products/variant/${variantId}`, {
    headers: { Authorization: `Bearer ${PRINTFUL_API_KEY}` },
  });

  if (!res.ok) return null;

  const data = await res.json();
  const file = data.result?.files?.find((f) => f.type === "preview" || f.type === "default");
  return file?.url ?? null;
}

async function isValidPrintfulVariant(variantId) {
  try {
    const res = await fetch(`https://api.printful.com/products/variant/${variantId}`, {
      headers: { Authorization: `Bearer ${PRINTFUL_API_KEY}` }
    });

    if (res.status === 404 || !res.ok) return false;

    const data = await res.json();
    return !!(data.result?.variant_id && data.result?.files?.length > 0);
  } catch {
    return false;
  }
}

async function sync() {
  const res = await fetch("https://api.printful.com/sync/products", {
    headers: { Authorization: `Bearer ${PRINTFUL_API_KEY}` }
  });

  const productList = (await res.json()).result;
  const insertMappings = [];

  for (const product of productList) {
    const detailRes = await fetch(`https://api.printful.com/sync/products/${product.id}`, {
      headers: { Authorization: `Bearer ${PRINTFUL_API_KEY}` }
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
        options
      } = variant;

      if (is_deleted || is_ignored || !(await isValidPrintfulVariant(printful_variant_id))) continue;

      const stripeProduct = await stripe.products.create({
        name: `${productName} - ${variantName}`
      });

      const stripePrice = await stripe.prices.create({
        product: stripeProduct.id,
        unit_amount: Math.round(parseFloat(retail_price) * 100),
        currency: "cad"
      });

      const imageUrl = await getPrintfulImageURL(printful_variant_id);
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
        mode: MODE
      });

      console.log(`✅ Synced ${variantName} → Stripe price ${stripePrice.id} [${MODE}]`);
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

  console.log(`🎉 Synced ${insertMappings.length} variants to Supabase`);
}

sync();