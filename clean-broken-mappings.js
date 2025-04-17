// clean-broken-mappings.js
// This script removes broken Printful variant mappings from Supabase
// A variant is considered broken if it returns 404 or lacks image files from Printful

import dotenv from "dotenv";
import fetch from "node-fetch";
dotenv.config();

// Load environment variables
const PRINTFUL_API_KEY = process.env.PRINTFUL_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Check if a Printful variant is still valid (exists and has image files)
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
  }

  if (toDelete.length === 0) {
    console.log("✅ No broken variants found.");
    return;
  }

  for (const id of toDelete) {
    await fetch(`${SUPABASE_URL}/rest/v1/variant_mappings?printful_variant_id=eq.${id}`, {
      method: "DELETE",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
      }
    });
  }

  console.log(`🧹 Deleted ${toDelete.length} broken mappings from Supabase.`);
}

// Run the cleaner
cleanBrokenMappings();