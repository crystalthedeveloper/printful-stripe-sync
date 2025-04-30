// Supabase Edge Function: get-printful-variants-test.ts
// Fetches product variants from Printful and enriches them with Stripe price mapping from Supabase

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const PRINTFUL_API_KEY = Deno.env.get("PRINTFUL_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const corsHeaders = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
};

interface SyncVariant {
  id: number;
  name: string;
  size: string;
  color: string;
  available: boolean;
  retail_price: string;
}

interface Mapping {
  printful_variant_id: number;
  stripe_price_id: string;
  image_url: string;
}

Deno.serve(async (req: Request): Promise<Response> => {
  const { searchParams } = new URL(req.url);
  const productId = searchParams.get("product_id");

  if (!PRINTFUL_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("❌ Missing environment variable.");
    return new Response(JSON.stringify({ error: "Server misconfiguration" }), {
      status: 500,
      headers: corsHeaders,
    });
  }

  if (!productId) {
    return new Response(JSON.stringify({ error: "Missing product_id" }), {
      status: 400,
      headers: corsHeaders,
    });
  }

  try {
    // 1. Fetch product + variants from Printful
    const res = await fetch(`https://api.printful.com/store/products/${productId}`, {
      headers: {
        Authorization: `Bearer ${PRINTFUL_API_KEY}`,
        "Content-Type": "application/json",
      },
    });

    if (!res.ok) {
      const error = await res.json();
      return new Response(JSON.stringify({ error: error.message || "Printful API error" }), {
        status: res.status,
        headers: corsHeaders,
      });
    }

    const product = await res.json();
    const syncVariants: SyncVariant[] = product.result.sync_variants;

    // 2. Fetch mappings from Supabase with image_url
    const variantIds = syncVariants.map((v) => v.id).join(",");
    const mappingRes = await fetch(
      `${SUPABASE_URL}/rest/v1/variant_mappings?select=printful_variant_id,stripe_price_id,image_url&printful_variant_id=in.(${variantIds})&mode=eq.test`,    
      {
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    const mappings: Mapping[] = await mappingRes.json();
    const mappingMap = new Map(
      mappings.map((m) => [String(m.printful_variant_id), { stripe_price_id: m.stripe_price_id, image_url: m.image_url }])
    );

    // 3. Merge Printful + Supabase data
    const variants = syncVariants.map((v) => {
      const mapping = mappingMap.get(String(v.id));
      return {
        id: v.id,
        variant_name: v.name, // ✅ Use `variant_name` instead of `name`
        size: v.size,
        color: v.color,
        available: v.available !== false,
        retail_price: v.retail_price,
        stripe_price_id: mapping?.stripe_price_id || null,
        image_url: mapping?.image_url || "",
      };
    });

    return new Response(JSON.stringify({ variants }), {
      status: 200,
      headers: corsHeaders,
    });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});