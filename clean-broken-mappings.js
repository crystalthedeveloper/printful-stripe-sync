// clean-broken-mappings.js
// Removes broken Printful variant mappings from Supabase

import dotenv from "dotenv";
import fetch from "node-fetch";
dotenv.config();

const PRINTFUL_API_KEY = process.env.PRINTFUL_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function variantStillValid(variantId) {
  const res = await fetch(`https://api.printful.com/products/variant/${variantId}`, {
    headers: { Authorization: `Bearer ${PRINTFUL_API_KEY}` }
  });

  if (res.status === 404) return false;
  if (!res.ok) {
    console.warn(`⚠️ API error for variant ${variantId}: ${res.statusText}`);
    return false;
  }

  const data = await res.json();
  return !!(data.result?.variant_id && data.result?.files?.length > 0);
}

async function clean() {
  console.log("🧹 Checking for broken mappings...");

  const res = await fetch(`${SUPABASE_URL}/rest/v1/variant_mappings?select=printful_variant_id`, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
    }
  });

  const mappings = await res.json();
  if (!res.ok) {
    console.error("❌ Failed to fetch variant_mappings:", mappings);
    process.exit(1);
  }

  const toDelete = [];

  for (const { printful_variant_id } of mappings) {
    const isValid = await variantStillValid(printful_variant_id);
    if (!isValid) {
      console.warn(`❌ Deleting broken variant: ${printful_variant_id}`);
      toDelete.push(printful_variant_id);
    }
  }

  if (toDelete.length === 0) {
    console.log("✅ No broken mappings found.");
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

  console.log(`🧹 Cleaned ${toDelete.length} broken mappings from Supabase.`);
}

clean();