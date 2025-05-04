// get-printful-variants.ts (Stripe + Printful Only - using sync_variant_id)

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
    sync_product?: {
      name?: string;
      thumbnail_url?: string;
    };
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
      return new Response(JSON.stringify({ error: error.message || "Printful API error" }), {
        status: res.status,
        headers: corsHeaders,
      });
    }

    const product: PrintfulProductResponse = await res.json();
    const syncVariants = product.result?.sync_variants ?? [];
    const productName = product.result?.sync_product?.name || "";
    const fallbackImage = product.result?.sync_product?.thumbnail_url || "";

    const variants = syncVariants.map((v) => {
      const previewFile = v.files?.find((f) => f.type === "preview");
      const previewImage = previewFile?.preview_url || v.product?.image || fallbackImage;
      const baseCode = v.name.split("/")[0].trim();
      const stripeName = `${baseCode} - ${v.name}`;

      return {
        sync_variant_id: v.id,
        variant_name: v.name,
        stripe_product_name: stripeName,
        printful_product_name: productName,
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
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});