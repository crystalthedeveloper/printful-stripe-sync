// get-printful-variants.ts — includes Stripe price IDs
import Stripe from "https://esm.sh/stripe@12.1.0?target=deno";

const STRIPE_SECRET_TEST = Deno.env.get("STRIPE_SECRET_TEST");
const STRIPE_SECRET_LIVE = Deno.env.get("STRIPE_SECRET_KEY");
const PRINTFUL_API_KEY = Deno.env.get("PRINTFUL_API_KEY");

const corsHeaders = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
};

interface PrintfulFile {
  type: string;
  preview_url?: string;
}

interface PrintfulProduct {
  name?: string;
  image?: string;
}

interface PrintfulVariant {
  id: number;
  name: string;
  size?: string;
  color?: string;
  available?: boolean;
  retail_price: string;
  files?: PrintfulFile[];
  product?: PrintfulProduct;
}

Deno.serve(async (req: Request): Promise<Response> => {
  const { searchParams } = new URL(req.url);
  const productId = searchParams.get("product_id");
  const mode = searchParams.get("mode") || "live";

  const STRIPE_SECRET = mode === "live" ? STRIPE_SECRET_LIVE : STRIPE_SECRET_TEST;
  const stripe = new Stripe(STRIPE_SECRET, { apiVersion: "2023-10-16" });

  if (!PRINTFUL_API_KEY || !STRIPE_SECRET) {
    return new Response(JSON.stringify({ error: "Missing keys" }), {
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
    const res = await fetch(`https://api.printful.com/store/products/${productId}`, {
      headers: {
        Authorization: `Bearer ${PRINTFUL_API_KEY}`,
        "Content-Type": "application/json",
      },
    });

    if (!res.ok) {
      const error = await res.json();
      return new Response(JSON.stringify({ error: error.message }), {
        status: res.status,
        headers: corsHeaders,
      });
    }

    const data = await res.json();
    const variants: PrintfulVariant[] = data.result.sync_variants || [];

    const results = await Promise.all(
      variants.map(async (variant: PrintfulVariant) => {
        const sanitize = (s: string): string =>
          (s || "")
            .replace(/\|/g, "")
            .replace(/[()]/g, "")
            .replace(/[^\w\s-]/g, "")
            .trim();

        const productName = sanitize(variant.product?.name || "");
        const variantName = sanitize(variant.name);
        const composedName = `${productName} - ${variantName}`;
        const syncId = String(variant.id);

        let stripe_price_id: string | null = null;
        try {
          const priceSearch = await stripe.prices.search({
            query: `metadata['sync_variant_id']:'${syncId}'`,
          });
          if (priceSearch.data.length > 0) {
            stripe_price_id = priceSearch.data[0].id;
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown Stripe error";
          console.warn("⚠️ Stripe price search failed for", syncId, message);
        }

        const previewFile = variant.files?.find((f: PrintfulFile) => f.type === "preview");

        return {
          sync_variant_id: syncId,
          variant_name: variantName,
          stripe_product_name: composedName,
          printful_product_name: productName,
          size: variant.size?.toUpperCase() || "N/A",
          color: variant.color?.toLowerCase() || "unknown",
          available: variant.available !== false,
          retail_price: variant.retail_price,
          image_url: previewFile?.preview_url || variant.product?.image || "",
          stripe_price_id,
        };
      })
    );

    return new Response(JSON.stringify({ mode, variants: results }), {
      status: 200,
      headers: corsHeaders,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected server error";
    console.error("❌ Failed:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});