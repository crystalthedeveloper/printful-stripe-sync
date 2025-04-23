// clean-broken-mappings.js
// Safely removes only broken Printful store variant mappings from Supabase (404 or no image)

import dotenv from "dotenv";
import fetch from "node-fetch";
dotenv.config();

// ENV setup
const PRINTFUL_API_KEY = process.env.PRINTFUL_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DRY_RUN = process.env.DRY_RUN === "true";
const delayMs = 200;

// Checks if the variant exists and includes a 'mockup' image
async function isValidVariant(variantId) {
  try {
    const res = await fetch(`https://api.printful.com/store/variants/${variantId}`, {
      headers: { Authorization: `Bearer ${PRINTFUL_API_KEY}` }
    });

    if (res.status === 404) return false;
    if (!res.ok) {
      console.warn(`⚠️ API error on ${variantId}: ${res.statusText}`);
      return false;
    }

    const data = await res.json();
    const mockupFile = data.result?.files?.find(f => f.type === "mockup");
    return !!(data.result?.id && mockupFile?.preview_url);
  } catch (err) {
    console.error(`❌ Network error on ${variantId}:`, err.message);
    return false;
  }
}

// Main cleaning function
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
    console.error("❌ Failed to fetch mappings:", error);
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
    await new Promise(res => setTimeout(res, delayMs));
  }

  if (toDelete.length === 0) {
    console.log("✅ All variants valid. No deletions needed.");
    return;
  }

  if (DRY_RUN) {
    console.log("🚫 DRY RUN — would delete these:");
    console.table(toDelete.map(id => ({ printful_variant_id: id })));
    return;
  }

  console.log(`🧹 Deleting ${toDelete.length} broken variants...`);

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

  console.log(`✅ Deleted ${success} mappings. ❌ Failed: ${failed}`);
}

cleanBrokenMappings();