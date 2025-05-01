// lookup-stripe-price.ts

import Stripe from "https://esm.sh/stripe@12.1.0?target=deno";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2023-10-16",
});

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

  if (!product_name || !mode) {
    return new Response(JSON.stringify({ error: "Missing product_name or mode" }), {
      status: 400,
      headers: corsHeaders,
    });
  }

  try {
    const products = await stripe.products.list({ limit: 100 });

    const normalizedName = product_name.trim().toLowerCase();
    const product = products.data.find(
      (p: Stripe.Product) => p.name.trim().toLowerCase() === normalizedName
    );

    if (!product) {
      return new Response(JSON.stringify({ error: "Product not found" }), {
        status: 404,
        headers: corsHeaders,
      });
    }

    const prices = await stripe.prices.list({ product: product.id, limit: 1 });
    const priceId = prices.data[0]?.id;

    if (!priceId) {
      return new Response(JSON.stringify({ error: "No price found for product" }), {
        status: 404,
        headers: corsHeaders,
      });
    }

    return new Response(JSON.stringify({ stripe_price_id: priceId }), {
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