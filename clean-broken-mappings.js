// clean-broken-mappings.js
// Removes only broken Printful variant mappings from Supabase (404 or missing mockup image)
// clean-broken-mappings.js (Updated)
import dotenv from "dotenv";
import fetch from "node-fetch";
dotenv.config();

const PRINTFUL_API_KEY = process.env.PRINTFUL_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DRY_RUN = process.env.DRY_RUN === "true";
const delayMs = 200;

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

      // 🔄 Try matching based on name/size/color if ID changed
      for (const v of detailData.result?.sync_variants || []) {
        if (v.name.includes(variantId)) return { productId: product.id, variant: v };
      }
    }

    return null;
  } catch (err) {
    console.warn(`⚠️ Failed to fetch variant info for ${variantId}: ${err.message}`);
    return null;
  }
}

async function cleanBrokenMappings() {
  console.log("🧹 Validating Supabase variant mappings...");

  const fetchRes = await fetch(`${SUPABASE_URL}/rest/v1/variant_mappings?select=id,printful_variant_id`, {
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
  const toUpdate = [];
  const toDelete = [];
  const seen = new Set();

  for (const row of mappings) {
    const variantId = row.printful_variant_id;
    if (seen.has(variantId)) {
      console.warn(`⚠️ Duplicate variant ID detected: ${variantId}`);
      toDelete.push(row.id);
      continue;
    }

    seen.add(variantId);

    const info = await getProductVariantInfo(variantId);
    if (!info || !info.variant?.files?.find(f => f.type === "preview")) {
      console.warn(`🗑️ Invalid or no image for variant ${variantId}`);
      toDelete.push(row.id);
    } else if (String(info.variant.id) !== String(variantId)) {
      console.log(`✏️ Updating variant ${variantId} → ${info.variant.id}`);
      toUpdate.push({ id: row.id, newVariantId: info.variant.id });
    }

    await new Promise(res => setTimeout(res, delayMs));
  }

  // 🧹 Handle Updates
  for (const u of toUpdate) {
    if (DRY_RUN) {
      console.log(`DRY RUN: Would update ${u.id} to new ID ${u.newVariantId}`);
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
        console.error(`❌ Failed to update ID ${u.id}:`, await updateRes.text());
      } else {
        console.log(`✅ Updated Supabase row ${u.id} → ${u.newVariantId}`);
      }
    }
  }

  // 🗑️ Handle Deletions
  for (const id of toDelete) {
    if (DRY_RUN) {
      console.log(`DRY RUN: Would delete ${id}`);
    } else {
      const deleteRes = await fetch(`${SUPABASE_URL}/rest/v1/variant_mappings?id=eq.${id}`, {
        method: "DELETE",
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
        }
      });

      if (!deleteRes.ok) {
        console.error(`❌ Failed to delete row ${id}:`, await deleteRes.text());
      } else {
        console.log(`🗑️ Deleted Supabase row ${id}`);
      }
    }
  }

  console.log("✅ Cleanup completed.");
}

cleanBrokenMappings();