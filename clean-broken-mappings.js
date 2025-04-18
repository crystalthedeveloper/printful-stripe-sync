// clean-broken-mappings.js
// Safely removes only broken Printful store variant mappings from Supabase (404 or no image)

import dotenv from "dotenv";
import fetch from "node-fetch";
dotenv.config();

// ENV
const PRINTFUL_API_KEY = process.env.PRINTFUL_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DRY_RUN = process.env.DRY_RUN === "true";
const delayMs = 200;

// Check if Printful store variant is valid (exists and has preview image)
async function variantStillValid(variantId) {
  try {
    const res = await fetch(`https://api.printful.com/store/variants/${variantId}`, {
      headers: { Authorization: `Bearer ${PRINTFUL_API_KEY}` }
    });

    if (res.status === 404) return false;
    if (!res.ok) {
      console.warn(`⚠️ API error on variant ${variantId}: ${res.statusText}`);
      return false;
    }

    const data = await res.json();
    return !!(data.result?.id && data.result?.files?.length > 0);
  } catch (err) {
    console.error(`❌ Network error for variant ${variantId}:`, err.message);
    return false;
  }
}

// Main cleanup function
async function cleanBrokenMappings() {
  console.log("🧹 Checking for broken Printful variants...");

  const fetchRes = await fetch(`${SUPABASE_URL}/rest/v1/variant_mappings?select=printful_variant_id`, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
    }
  });

  if (!fetchRes.ok) {
    const error = await fetchRes.text();
    console.error("❌ Failed to fetch from Supabase:", error);
    return;
  }

  const mappings = await fetchRes.json();
  const toDelete = [];

  for (const { printful_variant_id } of mappings) {
    const isValid = await variantStillValid(printful_variant_id);
    if (!isValid) {
      console.warn(`🗑️ Invalid: ${printful_variant_id}`);
      toDelete.push(printful_variant_id);
    }
    await new Promise(res => setTimeout(res, delayMs));
  }

  if (toDelete.length === 0) {
    console.log("✅ All variants are valid. Nothing to delete.");
    return;
  }

  if (DRY_RUN) {
    console.log("🚫 DRY RUN active — these would be deleted:");
    console.table(toDelete.map(id => ({ printful_variant_id: id })));
    return;
  }

  console.log(`🧹 Deleting ${toDelete.length} broken variants from Supabase...`);

  const results = await Promise.allSettled(toDelete.map(id =>
    fetch(`${SUPABASE_URL}/rest/v1/variant_mappings?printful_variant_id=eq.${id}`, {
      method: "DELETE",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
      }
    })
  ));

  const success = results.filter(r => r.status === "fulfilled").length;
  const failed = results.length - success;

  console.log(`✅ Deleted ${success} broken mappings. ❌ Failed to delete: ${failed}`);
}

cleanBrokenMappings();