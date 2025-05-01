// sync-printful-to-stripe.js
// Syncs Printful variants to Stripe and Supabase with update logic and duplicate cleanup

import dotenv from "dotenv";
import Stripe from "stripe";
import fetch from "node-fetch";
dotenv.config();

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const PRINTFUL_API_KEY = process.env.PRINTFUL_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DRY_RUN = process.env.DRY_RUN === "true";
const MODE = "live";

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2023-10-16" });

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

async function getExistingMappings(variantId) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/variant_mappings?printful_variant_id=eq.${variantId}&mode=eq.${MODE}`, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!res.ok) return [];
  return await res.json();
}

async function sync() {
  console.log("🔄 Starting Printful to Stripe & Supabase sync (LIVE mode)...");

  const productRes = await fetch("https://api.printful.com/sync/products", {
    headers: { Authorization: `Bearer ${PRINTFUL_API_KEY}` },
  });

  const productList = (await productRes.json()).result;
  const insertMappings = [];
  const updateMappings = [];

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

      if (is_deleted || is_ignored) continue;

      const imageUrl = await getPrintfulImageURLFromProduct(product.id, printful_variant_id);
      const color = options?.find(o => o.id === "color")?.value || "";
      const size = options?.find(o => o.id === "size")?.value || "";

      const existing = await getExistingMappings(printful_variant_id);
      const data = {
        printful_variant_id: printful_variant_id.toString(),
        retail_price: parseFloat(retail_price),
        image_url: imageUrl,
        color,
        size,
        variant_name: variantName,
        mode: MODE,
        created_at: new Date().toISOString(),
      };

      if (existing.length > 1) {
        const duplicates = existing.slice(1);
        await Promise.allSettled(duplicates.map(r =>
          fetch(`${SUPABASE_URL}/rest/v1/variant_mappings?id=eq.${r.id}`, {
            method: "DELETE",
            headers: {
              apikey: SUPABASE_SERVICE_ROLE_KEY,
              Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            },
          })
        ));
      }

      if (existing.length === 1) {
        const id = existing[0].id;
        updateMappings.push({ id, ...data });
      } else {
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
          data.stripe_price_id = stripePrice.id;
          insertMappings.push(data);
        } catch (err) {
          console.error(`❌ Stripe error for ${printful_variant_id}: ${err.message}`);
        }
      }
    }
  }

  if (DRY_RUN) {
    console.log("🧪 DRY RUN — Insert:");
    console.table(insertMappings.map(v => ({ variant: v.variant_name, stripe_price_id: v.stripe_price_id })));
    console.log("🧪 DRY RUN — Update:");
    console.table(updateMappings.map(v => ({ id: v.id, variant: v.variant_name })));
    return;
  }

  if (insertMappings.length) {
    await fetch(`${SUPABASE_URL}/rest/v1/variant_mappings`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(insertMappings),
    });
  }

  if (updateMappings.length) {
    for (const update of updateMappings) {
      const { id, ...fields } = update;
      await fetch(`${SUPABASE_URL}/rest/v1/variant_mappings?id=eq.${id}`, {
        method: "PATCH",
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify(fields),
      });
    }
  }

  console.log(`🎉 Sync complete — Inserted: ${insertMappings.length}, Updated: ${updateMappings.length}`);
}

sync();