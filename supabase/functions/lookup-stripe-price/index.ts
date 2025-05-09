// Supabase Edge Function: lookup-stripe-price.ts
// Looks up the Stripe price using product name or composed metadata

import Stripe from "https://esm.sh/stripe@12.1.0?target=deno";
import type { Product, Price } from "https://esm.sh/stripe@12.1.0?target=deno"; // 👈 Fix: import types

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
  // Normalize the product name to account for inconsistencies in spacing or SKU suffixes, improving compatibility on mobile

  try {
    const normalized = product_name
      .replace(/[()]/g, "")
      .replace(/\s+/g, " ")
      .replace(/[-_/\\]+$/, "")
      .replace(/[^\w\s-]/g, "")
      .replace(/[-]/g, "")
      .toLowerCase()
      .trim();
    console.log("🔍 Searching for product:", normalized);

    const products = await stripe.products.list({ limit: 100 });

    const product = products.data.find((p: Product) => {
      const normalize = (str?: string) =>
        (str || "")
          .replace(/[()]/g, "")
          .replace(/\s+/g, " ")
          .replace(/[^\w\s-]/g, "")
          .replace(/[-]/g, "")
          .toLowerCase()
          .trim();

      const name = normalize(p.name);
      const variantName = normalize(p.metadata?.printful_variant_name);
      const productName = normalize(p.metadata?.printful_product_name);
      const composed = normalize(`${productName} - ${variantName}`);

      return (
        name === normalized ||
        variantName === normalized ||
        composed === normalized ||
        name.includes(normalized) ||
        composed.includes(normalized)
      );
    });

    if (!product) {
      console.warn("⚠️ Product not found for name:", normalized);
      return new Response(JSON.stringify({ error: "Product not found" }), {
        status: 404,
        headers: corsHeaders,
      });
    }

    const prices = await stripe.prices.list({ product: product.id, limit: 100 });

    const activePrice = prices.data.find((p: Price) => p.active); // 👈 Fix: type price too
    if (!activePrice) {
      return new Response(JSON.stringify({ error: "No active price found for product" }), {
        status: 404,
        headers: corsHeaders,
      });
    }

    const cleanMetadata = { ...product.metadata };
    delete cleanMetadata.printful_variant_id;
    delete cleanMetadata.legacy_printful_variant_id;
    delete cleanMetadata.legacy_printful_sync_product_id;

    return new Response(
      JSON.stringify({
        stripe_price_id: activePrice.id,
        currency: activePrice.currency,
        amount: activePrice.unit_amount,
        retail_price: (activePrice.unit_amount || 0) / 100, // Ensure frontend can display the price
        metadata: activePrice.metadata,
        product: {
          id: product.id,
          name: product.name,
          metadata: cleanMetadata,
        },
      }),
      { status: 200, headers: corsHeaders }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    console.error("❌ lookup-stripe-price error:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});