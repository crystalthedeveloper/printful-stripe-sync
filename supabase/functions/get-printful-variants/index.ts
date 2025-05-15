// Supabase Edge Function: get-printful-variants.ts
// Fetches all variants from a Printful product by product_id

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
  id: number;
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
  const mode = searchParams.get("mode") || "live"; // optional for future use

  // Allow all product IDs including test ones on mobile
  if (productId && productId.startsWith("00") && mode !== "live") {
    return new Response(JSON.stringify({ mode, variants: [] }), {
      status: 200,
      headers: corsHeaders,
    });
  }

  if (!PRINTFUL_API_KEY) {
    return new Response(JSON.stringify({ error: "Missing Printful API key" }), {
      status: 500,
      headers: corsHeaders,
    });
  }

  if (!productId || isNaN(Number(productId))) {
    return new Response(JSON.stringify({ error: "Invalid or missing product_id" }), {
      status: 400,
      headers: corsHeaders,
    });
  }

  try {
    const response = await fetch(`https://api.printful.com/store/products/${productId}`, {
      headers: {
        Authorization: `Bearer ${PRINTFUL_API_KEY}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const error = await response.json();
      console.error("❌ Printful API error:", error);
      return new Response(JSON.stringify({ error: error.message || "Printful API error" }), {
        status: response.status,
        headers: corsHeaders,
      });
    }

    const data: PrintfulProductResponse = await response.json();
    const variants = (data.result?.sync_variants || []).map((variant) => {
      const previewFile = variant.files?.find((file) => file.type === "preview");
      const imageUrl = previewFile?.preview_url || variant.product?.image || "";

      // Sanitize names to match Stripe metadata
      const sanitizeName = (name: string = "") =>
        name
          .replace(/\|/g, "")
          .replace(/[()]/g, "")
          .replace(/[^\w\s-]/g, "")
          .trim();

      const originalProductName = variant.product?.name || "";
      const originalVariantName = variant.name;

      const sanitizedProductName = sanitizeName(originalProductName);
      const sanitizedVariantName = sanitizeName(originalVariantName);
      const stripeProductName = `${sanitizedProductName} - ${sanitizedVariantName}`;

      console.log("🔍 Stripe Name Mapping:", {
        originalProductName,
        originalVariantName,
        sanitizedProductName,
        sanitizedVariantName,
        stripeProductName
      });

      return {
        sync_variant_id: variant.id,
        variant_name: sanitizedVariantName,
        stripe_product_name: stripeProductName,
        printful_product_name: sanitizedProductName, // ✅ sanitized product name
        size: variant.size?.toUpperCase() || "N/A",
        color: variant.color?.toLowerCase() || "unknown",
        available: variant.available !== false,
        retail_price: variant.retail_price,
        image_url: imageUrl,
      };
    });

    return new Response(JSON.stringify({ mode, variants }), {
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