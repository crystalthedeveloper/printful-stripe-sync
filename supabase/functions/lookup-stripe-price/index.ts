// lookup-stripe-price.ts — Find a Stripe price by product_name (matches either name or printful_variant_name)

import Stripe from "https://esm.sh/stripe@12.1.0?target=deno";

const STRIPE_SECRET_TEST = Deno.env.get("STRIPE_SECRET_TEST");
const STRIPE_SECRET_LIVE = Deno.env.get("STRIPE_SECRET_KEY");

interface LookupRequest {
  product_name: string;
  mode: "test" | "live";
}

const corsHeaders = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: corsHeaders,
    });
  }

  let body: LookupRequest;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: corsHeaders,
    });
  }

  const { product_name, mode } = body;

  if (!product_name || !mode || !["test", "live"].includes(mode)) {
    return new Response(JSON.stringify({ error: "Missing or invalid product_name or mode" }), {
      status: 400,
      headers: corsHeaders,
    });
  }

  const STRIPE_SECRET = mode === "live" ? STRIPE_SECRET_LIVE : STRIPE_SECRET_TEST;

  if (!STRIPE_SECRET) {
    return new Response(JSON.stringify({ error: `Stripe key for mode '${mode}' is not set` }), {
      status: 500,
      headers: corsHeaders,
    });
  }

  const stripe = new Stripe(STRIPE_SECRET, { apiVersion: "2023-10-16" });

  try {
    const normalized = product_name.trim().toLowerCase();

    const products = await stripe.products.list({ limit: 100 });

    const product = products.data.find((p: Stripe.Product) => {
      const name = p.name?.trim().toLowerCase() || "";
      const variantName = p.metadata?.printful_variant_name?.trim().toLowerCase() || "";
      return name === normalized || variantName === normalized;
    });

    if (!product) {
      return new Response(JSON.stringify({ error: "Product not found" }), {
        status: 404,
        headers: corsHeaders,
      });
    }

    const prices = await stripe.prices.list({ product: product.id, limit: 1 });

    if (!prices.data.length) {
      return new Response(JSON.stringify({ error: "No price found for product" }), {
        status: 404,
        headers: corsHeaders,
      });
    }

    const price = prices.data[0];

    // Clean metadata for product
    const cleanMetadata = { ...product.metadata };
    delete cleanMetadata.printful_variant_id;
    delete cleanMetadata.legacy_printful_variant_id;
    delete cleanMetadata.legacy_printful_sync_product_id;

    return new Response(
      JSON.stringify({
        stripe_price_id: price.id,
        currency: price.currency,
        amount: price.unit_amount,
        metadata: price.metadata,
        product: {
          id: product.id,
          name: product.name,
          metadata: cleanMetadata,
        },
      }),
      {
        status: 200,
        headers: corsHeaders,
      }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});