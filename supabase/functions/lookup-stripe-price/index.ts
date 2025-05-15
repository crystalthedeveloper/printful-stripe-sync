// Supabase Edge Function: lookup-stripe-price.ts
import Stripe from "https://esm.sh/stripe@12.1.0?target=deno";
import type { Product, Price } from "https://esm.sh/stripe@12.1.0?target=deno";

const STRIPE_SECRET_TEST = Deno.env.get("STRIPE_SECRET_TEST");
const STRIPE_SECRET_LIVE = Deno.env.get("STRIPE_SECRET_KEY");

interface LookupRequest {
  product_name?: string;
  sync_variant_id?: string;
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

  const { product_name, sync_variant_id, mode } = body;

  if (!mode || !["test", "live"].includes(mode)) {
    return new Response(JSON.stringify({ error: "Missing or invalid mode" }), {
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

  console.log("🔑 Using Stripe mode:", mode, "Prefix:", STRIPE_SECRET.slice(0, 10));

  const stripe = new Stripe(STRIPE_SECRET, { apiVersion: "2023-10-16" });

  try {
    // 🔍 1. Prefer sync_variant_id for exact match
    if (sync_variant_id) {
      const priceSearch = await stripe.prices.search({
        query: `metadata['sync_variant_id']:'${sync_variant_id}'`,
      });

      if (priceSearch.data.length > 0) {
        const price = priceSearch.data[0];
        const product = await stripe.products.retrieve(price.product as string);

        console.log("✅ Found price via sync_variant_id:", price.id);
        return new Response(JSON.stringify({
          stripe_price_id: price.id,
          currency: price.currency,
          amount: price.unit_amount,
          retail_price: (price.unit_amount || 0) / 100,
          metadata: price.metadata,
          product: {
            id: product.id,
            name: product.name,
            metadata: product.metadata,
          },
        }), { status: 200, headers: corsHeaders });
      }

      console.warn("⚠️ No price found with sync_variant_id:", sync_variant_id);
    }

    // 🔍 2. Fallback: fuzzy match by normalized product_name
    if (!product_name) {
      return new Response(JSON.stringify({ error: "Missing product_name or sync_variant_id" }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    const normalize = (str?: string) =>
      (str || "")
        .normalize("NFKD")
        .replace(/[’']/g, "")
        .replace(/[-()_/\\|]/g, "")
        .replace(/[^\w\s]/g, "")
        .replace(/\s+/g, " ")
        .toLowerCase()
        .trim();

    const normalizedInput = normalize(product_name);
    console.log("🔍 Fallback lookup for:", normalizedInput);

    const products = await stripe.products.list({ limit: 100 });

    const product = products.data.find((p: Product) => {
      const composed = normalize(`${p.metadata?.printful_product_name} - ${p.metadata?.printful_variant_name}`);
      const match = normalize(p.name) === normalizedInput || composed === normalizedInput || composed.includes(normalizedInput);
      const modeMatch = (p.metadata?.mode || "test") === mode;

      return match && modeMatch;
    });

    if (!product) {
      console.warn("❌ Product not found in fallback mode:", mode);
      return new Response(JSON.stringify({ error: "Product not found" }), {
        status: 404,
        headers: corsHeaders,
      });
    }

    const prices = await stripe.prices.list({ product: product.id, limit: 100 });
    const activePrice = prices.data.find((p: Price) => p.active);

    if (!activePrice) {
      return new Response(JSON.stringify({ error: "No active price found" }), {
        status: 404,
        headers: corsHeaders,
      });
    }

    return new Response(JSON.stringify({
      stripe_price_id: activePrice.id,
      currency: activePrice.currency,
      amount: activePrice.unit_amount,
      retail_price: (activePrice.unit_amount || 0) / 100,
      metadata: activePrice.metadata,
      product: {
        id: product.id,
        name: product.name,
        metadata: product.metadata,
      },
    }), { status: 200, headers: corsHeaders });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    console.error("❌ lookup-stripe-price error:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});