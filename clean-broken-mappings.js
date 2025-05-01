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

async function getProductVariantInfo(storeVariantId) {
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
      const variant = detailData.result?.sync_variants?.find(v => v.id === parseInt(storeVariantId));
      if (variant) return { productId: product.id, variant };
    }

    return null;
  } catch (err) {
    console.warn(`⚠️ Failed to find variant ${storeVariantId}: ${err.message}`);
    return null;
  }
}

async function cleanBrokenMappings() {
  console.log(`🧹 Validating Supabase variant mappings in ${MODE.toUpperCase()} mode...`);

  const fetchRes = await fetch(
    `${SUPABASE_URL}/rest/v1/variant_mappings?select=id,printful_store_variant_id&mode=eq.${MODE}`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    }
  );

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
    const storeVariantId = row.printful_store_variant_id;

    if (seen.has(storeVariantId)) {
      console.warn(`⚠️ Duplicate detected: ${storeVariantId}`);
      toDelete.push(row.id);
      continue;
    }

    seen.add(storeVariantId);

    const info = await getProductVariantInfo(storeVariantId);
    const hasPreview = info?.variant?.files?.some(f => f.type === "preview");

    if (!info || !hasPreview) {
      console.warn(`🗑️ Broken or missing preview: ${storeVariantId}`);
      toDelete.push(row.id);
    } else if (String(info.variant.id) !== String(storeVariantId)) {
      console.log(`✏️ Needs update: ${storeVariantId} → ${info.variant.id}`);
      toUpdate.push({ id: row.id, newId: info.variant.id });
    }

    await new Promise(res => setTimeout(res, delayMs));
  }

  // 🔧 Update incorrect store variant IDs
  for (const u of toUpdate) {
    if (DRY_RUN) {
      console.log(`DRY RUN: Would update row ${u.id} to ${u.newId}`);
    } else {
      const updateRes = await fetch(`${SUPABASE_URL}/rest/v1/variant_mappings?id=eq.${u.id}`, {
        method: "PATCH",
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ printful_store_variant_id: u.newId.toString() }),
      });

      if (!updateRes.ok) {
        console.error(`❌ Failed to update ${u.id}:`, await updateRes.text());
      } else {
        console.log(`✅ Updated row ${u.id} → ${u.newId}`);
      }
    }
  }

  // 🗑️ Remove broken or duplicate entries
  for (const id of toDelete) {
    if (DRY_RUN) {
      console.log(`DRY RUN: Would delete row ${id}`);
    } else {
      const deleteRes = await fetch(`${SUPABASE_URL}/rest/v1/variant_mappings?id=eq.${id}`, {
        method: "DELETE",
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
      });

      if (!deleteRes.ok) {
        console.error(`❌ Failed to delete ${id}:`, await deleteRes.text());
      } else {
        console.log(`🗑️ Deleted row ${id}`);
      }
    }
  }

  console.log("✅ Cleanup complete.");
}

cleanBrokenMappings();