// clean-broken-mappings.js
// Removes broken or outdated Printful variant mappings from Supabase

import dotenv from "dotenv";
import fetch from "node-fetch";
dotenv.config();

const PRINTFUL_API_KEY = process.env.PRINTFUL_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DRY_RUN = process.env.DRY_RUN === "true";
const MODE = process.env.MODE || "test";
const delayMs = 200;

// 🔍 Find product + variant based on variantId
async function getProductVariantInfo(variantId) {
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
      const variant = detailData.result?.sync_variants?.find(v => v.id === parseInt(variantId));

      if (variant) return { productId: product.id, variant };

      // If no match, fallback to partial match by name
      for (const v of detailData.result?.sync_variants || []) {
        if (v.name.includes(variantId)) return { productId: product.id, variant: v };
      }
    }

    return null;
  } catch (err) {
    console.warn(`⚠️ Failed to find variant ${variantId}: ${err.message}`);
    return null;
  }
}

async function cleanBrokenMappings() {
  console.log(`🧹 Validating Supabase mappings in ${MODE.toUpperCase()} mode...`);

  const fetchRes = await fetch(`${SUPABASE_URL}/rest/v1/variant_mappings?select=id,printful_variant_id&mode=eq.${MODE}`, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
    }
  });

  if (!fetchRes.ok) {
    const error = await fetchRes.text();
    console.error("❌ Failed to fetch mappings:", error);
    return;
  }

  const mappings = await fetchRes.json();
  const toUpdate = [];
  const toDelete = [];
  const seen = new Set();

  for (const row of mappings) {
    const variantId = row.printful_variant_id;
    if (seen.has(variantId)) {
      console.warn(`⚠️ Duplicate found: ${variantId}`);
      toDelete.push(row.id);
      continue;
    }

    seen.add(variantId);

    const info = await getProductVariantInfo(variantId);
    const previewOk = info?.variant?.files?.some(f => f.type === "preview");

    if (!info || !previewOk) {
      console.warn(`🗑️ Missing or invalid variant: ${variantId}`);
      toDelete.push(row.id);
    } else if (String(info.variant.id) !== String(variantId)) {
      console.log(`✏️ Needs update: ${variantId} → ${info.variant.id}`);
      toUpdate.push({ id: row.id, newVariantId: info.variant.id });
    }

    await new Promise(res => setTimeout(res, delayMs)); // prevent rate limit
  }

  // ✅ Update IDs
  for (const u of toUpdate) {
    if (DRY_RUN) {
      console.log(`DRY RUN: Would update row ${u.id} to ${u.newVariantId}`);
    } else {
      const updateRes = await fetch(`${SUPABASE_URL}/rest/v1/variant_mappings?id=eq.${u.id}`, {
        method: "PATCH",
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ printful_variant_id: u.newVariantId.toString() })
      });

      if (!updateRes.ok) {
        console.error(`❌ Update failed for ${u.id}:`, await updateRes.text());
      } else {
        console.log(`✅ Updated row ${u.id} → ${u.newVariantId}`);
      }
    }
  }

  // 🗑️ Delete broken
  for (const id of toDelete) {
    if (DRY_RUN) {
      console.log(`DRY RUN: Would delete row ${id}`);
    } else {
      const deleteRes = await fetch(`${SUPABASE_URL}/rest/v1/variant_mappings?id=eq.${id}`, {
        method: "DELETE",
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
        }
      });

      if (!deleteRes.ok) {
        console.error(`❌ Deletion failed for ${id}:`, await deleteRes.text());
      } else {
        console.log(`🗑️ Deleted row ${id}`);
      }
    }
  }

  console.log("✅ Cleanup complete.");
}

cleanBrokenMappings();