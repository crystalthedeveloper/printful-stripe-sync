// Supabase Edge Function: fetch-variants.ts
// Fetches product variants for a given Printful sync_product_id and adds stripe_price_id + retail_price

const PRINTFUL_API_KEY = Deno.env.get("PRINTFUL_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
};

// Type Definitions
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
}

Deno.serve(async (req: Request): Promise<Response> => {
  const { searchParams } = new URL(req.url);
  const productId = searchParams.get("product_id");

  if (!productId) {
    return new Response(JSON.stringify({ error: "Missing product_id" }), {
      status: 400,
      headers: corsHeaders,
    });
  }

  try {
    // 1. Fetch from Printful
    const printfulRes = await fetch(`https://api.printful.com/store/products/${productId}`, {
      headers: {
        Authorization: `Bearer ${PRINTFUL_API_KEY}`,
        "Content-Type": "application/json",
      },
    });

    if (!printfulRes.ok) {
      const error = await printfulRes.json();
      return new Response(JSON.stringify({ error: error.message || "Printful API error" }), {
        status: printfulRes.status,
        headers: corsHeaders,
      });
    }

    const product = await printfulRes.json();
    const syncVariants: SyncVariant[] = product.result.sync_variants;

    // 2. Get stripe mappings
    const variantIds = syncVariants.map((v) => v.id).join(",");
    const mappingRes = await fetch(
      `${SUPABASE_URL}/rest/v1/variant_mappings?printful_variant_id=in.(${variantIds})`,
      {
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    const mappings: Mapping[] = await mappingRes.json();
    const mappingMap = new Map(mappings.map((m) => [String(m.printful_variant_id), m.stripe_price_id]));

    // 3. Format response
    const variants = syncVariants.map((v) => ({
      id: v.id,
      name: v.name,
      size: v.size,
      color: v.color,
      available: v.available !== false,
      retail_price: v.retail_price,
      stripe_price_id: mappingMap.get(String(v.id)) || null,
    }));

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