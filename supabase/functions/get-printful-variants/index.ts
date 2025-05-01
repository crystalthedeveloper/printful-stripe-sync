// Supabase Edge Function: get-printful-variants.ts
// get-printful-variants.ts (Stripe + Printful Only)

const PRINTFUL_API_KEY = Deno.env.get("PRINTFUL_API_KEY");

const corsHeaders = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
};

Deno.serve(async (req: Request): Promise<Response> => {
  const { searchParams } = new URL(req.url);
  const productId = searchParams.get("product_id");

  if (!PRINTFUL_API_KEY) {
    return new Response(JSON.stringify({ error: "Missing Printful API key" }), {
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
    const syncVariants = product.result?.sync_variants || [];

    const variants = syncVariants.map((v: any) => {
      const previewFile = v.files?.find((f: any) => f.type === "preview");
      return {
        printful_store_variant_id: v.id,
        variant_name: v.name,
        size: v.size,
        color: v.color,
        available: v.available !== false,
        retail_price: v.retail_price,
        image_url: previewFile?.preview_url || "",
      };
    });

    return new Response(JSON.stringify({ variants }), {
      status: 200,
      headers: corsHeaders,
    });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});