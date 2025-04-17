// clean-broken-mappings.js
// Safely removes broken Printful variant mappings from Supabase
// Broken = 404 from Printful OR missing image files

import dotenv from "dotenv";
import fetch from "node-fetch";
dotenv.config();

// ENV
const PRINTFUL_API_KEY = process.env.PRINTFUL_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DRY_RUN = process.env.DRY_RUN === "true"; // prevent deletion if true
const delayMs = 200; // Optional delay between API calls

// Utility: check if Printful variant still exists and has image
async function variantStillValid(variantId) {
  try {
    const res = await fetch(`https://api.printful.com/products/variant/${variantId}`, {
      headers: { Authorization: `Bearer ${PRINTFUL_API_KEY}` }
    });

    if (res.status === 404) return false;
    if (!res.ok) {
      console.warn(`⚠️ Error checking variant ${variantId}: ${res.statusText}`);
      return false;
    }

    const data = await res.json();
    return !!(data.result?.variant_id && data.result?.files?.length > 0);
  } catch (err) {
    console.error(`❌ Error validating variant ${variantId}:`, err.message);
    return false;
  }
}

// Main clean-up function
async function cleanBrokenMappings() {
  console.log("🧹 Checking Supabase for broken Printful variant mappings...");

  const res = await fetch(`${SUPABASE_URL}/rest/v1/variant_mappings?select=printful_variant_id`, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
    }
  });

  if (!res.ok) {
    const error = await res.text();
    console.error("❌ Failed to fetch variant_mappings:", error);
    process.exit(1);
  }

  const mappings = await res.json();
  const toDelete = [];

  for (const { printful_variant_id } of mappings) {
    const isValid = await variantStillValid(printful_variant_id);
    if (!isValid) {
      console.warn(`🗑️ Marking for deletion: ${printful_variant_id}`);
      toDelete.push(printful_variant_id);
    }
    await new Promise(resolve => setTimeout(resolve, delayMs)); // Avoid hitting rate limits
  }

  if (toDelete.length === 0) {
    console.log("✅ No broken variants found.");
    return;
  }

  if (DRY_RUN) {
    console.log(`🔍 DRY RUN: Would have deleted ${toDelete.length} broken mappings`);
    console.table(toDelete);
    return;
  }

  console.log(`🧹 Deleting ${toDelete.length} broken mappings from Supabase...`);

  const deleteResults = await Promise.allSettled(toDelete.map(id =>
    fetch(`${SUPABASE_URL}/rest/v1/variant_mappings?printful_variant_id=eq.${id}`, {
      method: "DELETE",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
      }
    })
  ));

  const successCount = deleteResults.filter(r => r.status === "fulfilled").length;
  const failedCount = deleteResults.length - successCount;

  console.log(`✅ Deleted ${successCount} variants. ❌ Failed: ${failedCount}`);
}

// Run it
cleanBrokenMappings();