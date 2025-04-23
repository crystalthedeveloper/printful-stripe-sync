// clean-broken-mappings.js
// Removes only broken Printful variant mappings from Supabase (404 or missing mockup image)

import dotenv from "dotenv";
import fetch from "node-fetch";
dotenv.config();

const PRINTFUL_API_KEY = process.env.PRINTFUL_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DRY_RUN = process.env.DRY_RUN === "true";
const delayMs = 200;

// ✅ Finds the productId that contains this variantId
async function getProductIdFromVariantId(variantId) {
  try {
    const res = await fetch(`https://api.printful.com/sync/products`, {
      headers: { Authorization: `Bearer ${PRINTFUL_API_KEY}` },
    });

    if (!res.ok) return null;
    const data = await res.json();

    for (const product of data.result) {
      const detailRes = await fetch(`https://api.printful.com/sync/products/${product.id}`, {
        headers: { Authorization: `Bearer ${PRINTFUL_API_KEY}` },
      });

      if (!detailRes.ok) continue;

      const detailData = await detailRes.json();
      const found = detailData.result?.sync_variants?.find(v => v.id === parseInt(variantId));

      if (found) return { productId: product.id, variant: found };
    }

    return null;
  } catch (err) {
    console.warn(`⚠️ Failed to find product for variant ${variantId}: ${err.message}`);
    return null;
  }
}

// ✅ Checks if the variant exists and has a valid preview image
async function isValidVariant(variantId) {
  try {
    const info = await getProductIdFromVariantId(variantId);
    if (!info) return false;

    const preview = info.variant?.files?.find(f => f.type === "preview");
    return !!(info.variant?.id && preview?.preview_url);
  } catch (err) {
    console.error(`❌ Error validating variant ${variantId}:`, err.message);
    return false;
  }
}

// 🔍 Cleans broken records from Supabase
async function cleanBrokenMappings() {
  console.log("🧹 Starting variant validation...");

  const fetchRes = await fetch(`${SUPABASE_URL}/rest/v1/variant_mappings?select=printful_variant_id`, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
    }
  });

  if (!fetchRes.ok) {
    const error = await fetchRes.text();
    console.error("❌ Failed to fetch mappings from Supabase:", error);
    return;
  }

  const mappings = await fetchRes.json();
  const toDelete = [];

  for (const { printful_variant_id } of mappings) {
    const isValid = await isValidVariant(printful_variant_id);
    if (!isValid) {
      console.warn(`🗑️ Invalid: ${printful_variant_id}`);
      toDelete.push(printful_variant_id);
    }
    await new Promise(res => setTimeout(res, delayMs)); // avoid rate limits
  }

  if (toDelete.length === 0) {
    console.log("✅ All variants are valid. No deletions needed.");
    return;
  }

  if (DRY_RUN) {
    console.log("🚫 DRY RUN — would delete these variants:");
    console.table(toDelete.map(id => ({ printful_variant_id: id })));
    return;
  }

  console.log(`🧹 Deleting ${toDelete.length} broken variants from Supabase...`);

  const results = await Promise.allSettled(
    toDelete.map(id =>
      fetch(`${SUPABASE_URL}/rest/v1/variant_mappings?printful_variant_id=eq.${id}`, {
        method: "DELETE",
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
        }
      })
    )
  );

  const success = results.filter(r => r.status === "fulfilled").length;
  const failed = results.length - success;

  console.log(`✅ Deleted ${success} mappings. ❌ Failed to delete: ${failed}`);
}

cleanBrokenMappings();