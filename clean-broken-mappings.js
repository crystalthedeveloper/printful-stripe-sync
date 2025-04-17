// clean-broken-mappings.js
// Safely removes only broken Printful variant mappings from Supabase (404 or no image)

import dotenv from "dotenv";
import fetch from "node-fetch";
dotenv.config();

const PRINTFUL_API_KEY = process.env.PRINTFUL_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DRY_RUN = process.env.DRY_RUN === "true";
const delayMs = 200;

// Validate Printful variant (exists + has image)
async function variantStillValid(variantId) {
  try {
    const res = await fetch(`https://api.printful.com/products/variant/${variantId}`, {
      headers: { Authorization: `Bearer ${PRINTFUL_API_KEY}` }
    });

    if (res.status === 404) return false;
    if (!res.ok) return false;

    const data = await res.json();
    return !!(data.result?.variant_id && data.result?.files?.length > 0);
  } catch (err) {
    console.error(`❌ Error checking ${variantId}: ${err.message}`);
    return false;
  }
}

async function cleanBrokenMappings() {
  console.log("🧹 Checking for broken Printful variants...");

  const res = await fetch(`${SUPABASE_URL}/rest/v1/variant_mappings?select=printful_variant_id`, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
    }
  });

  const mappings = await res.json();
  const toDelete = [];

  for (const { printful_variant_id } of mappings) {
    const valid = await variantStillValid(printful_variant_id);
    if (!valid) {
      console.warn(`🗑️ Invalid: ${printful_variant_id}`);
      toDelete.push(printful_variant_id);
    }
    await new Promise(res => setTimeout(res, delayMs));
  }

  if (toDelete.length === 0) return console.log("✅ All variants are valid.");

  if (DRY_RUN) {
    console.log("🚫 DRY RUN active — these would be deleted:");
    console.table(toDelete);
    return;
  }

  console.log(`🧹 Deleting ${toDelete.length} broken variants...`);
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
  console.log(`✅ Deleted ${success} | ❌ Failed: ${failed}`);
}

cleanBrokenMappings();