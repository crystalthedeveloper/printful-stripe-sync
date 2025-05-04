// get-printful-variants.ts — Fetches all variants from a Printful product by product_id

const PRINTFUL_API_KEY = Deno.env.get("PRINTFUL_API_KEY");

const corsHeaders = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
};

interface PrintfulVariantFile {
  type: string;
  preview_url?: string;
}

interface PrintfulSyncVariant {
  id: number; // sync_variant_id
  name: string;
  size: string;
  color: string;
  available: boolean;
  retail_price: string;
  files?: PrintfulVariantFile[];
  product?: {
    name?: string;
    image?: string;
  };
}

interface PrintfulProductResponse {
  result: {
    sync_variants: PrintfulSyncVariant[];
  };
}

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
      console.error("❌ Printful API error:", error);
      return new Response(JSON.stringify({ error: error.message || "Printful API error" }), {
        status: res.status,
        headers: corsHeaders,
      });
    }

    const data: PrintfulProductResponse = await res.json();
    const variants = (data.result?.sync_variants || []).map((v) => {
      const previewFile = v.files?.find((f) => f.type === "preview");
      const previewImage = previewFile?.preview_url || v.product?.image || "";

      const baseCode = v.name.split("/")[0].trim(); // e.g., "04H"
      const stripeProductName = `${baseCode} - ${v.name.trim()}`; // e.g., "04H - 04H / S"

      return {
        sync_variant_id: v.id,
        variant_name: v.name,
        stripe_product_name: stripeProductName,
        size: v.size,
        color: v.color,
        available: v.available !== false,
        retail_price: v.retail_price,
        image_url: previewImage,
      };
    });

    return new Response(JSON.stringify({ variants }), {
      status: 200,
      headers: corsHeaders,
    });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    console.error("❌ Exception in get-printful-variants.ts:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});