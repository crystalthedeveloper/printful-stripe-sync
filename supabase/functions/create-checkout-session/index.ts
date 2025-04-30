// Supabase Edge Function: create-checkout-session.ts
// Creates a Stripe Checkout session with Stripe API (test or live)

import { serve } from "https://deno.land/std@0.192.0/http/server.ts";

const stripeEndpoint = "https://api.stripe.com/v1/checkout/sessions";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://www.crystalthedeveloper.ca",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

const STRIPE_SECRET_LIVE = Deno.env.get("STRIPE_SECRET_KEY");
const STRIPE_SECRET_TEST = Deno.env.get("STRIPE_SECRET_TEST");

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("OK", { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
      status: 405,
      headers: corsHeaders,
    });
  }

  try {
    const {
      line_items,
      email,
      environment = "live", // 👈 control live/test mode
      mode = "payment",
      success_url = "https://www.crystalthedeveloper.ca/store/success",
      cancel_url = "https://www.crystalthedeveloper.ca/store/cancel",
      shipping_countries = ["US", "CA"],
    } = await req.json();

    // 🔍 Debug log input
    console.log("📦 Incoming request payload:", {
      environment,
      line_items,
      email,
      mode,
      success_url,
      cancel_url,
      shipping_countries
    });

    if (!Array.isArray(line_items) || line_items.length === 0) {
      console.error("❌ No line_items provided.");
      return new Response(JSON.stringify({ error: "Missing line_items" }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    const STRIPE_SECRET_KEY = environment === "test" ? STRIPE_SECRET_TEST : STRIPE_SECRET_LIVE;

    // 🔐 Debug which key is being used
    console.log("🔐 Using environment:", environment);
    console.log("🔑 STRIPE_SECRET_KEY starts with:", STRIPE_SECRET_KEY?.slice(0, 8));

    if (!STRIPE_SECRET_KEY) {
      return new Response(JSON.stringify({ error: `Missing Stripe secret for ${environment}` }), {
        status: 500,
        headers: corsHeaders,
      });
    }

    interface LineItem {
      price?: string;
      stripe_price_id?: string;
      quantity?: number;
    }

    const formData = new URLSearchParams();
    formData.append("mode", mode);
    formData.append("success_url", success_url);
    formData.append("cancel_url", cancel_url);
    formData.append("payment_method_types[0]", "card");

    line_items.forEach((item: LineItem, index: number) => {
      const priceId = item.price || item.stripe_price_id;
      if (!priceId) {
        console.warn(`⚠️ Missing price for item at index ${index}:`, item);
        return;
      }

      formData.append(`line_items[${index}][price]`, priceId);
      formData.append(`line_items[${index}][quantity]`, String(item.quantity || 1));
    });

    if (shipping_countries.length > 0) {
      shipping_countries.forEach((code: string, i: number) => {
        formData.append(`shipping_address_collection[allowed_countries][${i}]`, code);
      });
    }

    if (email) {
      formData.append("customer_email", email);
    }

    console.log("📤 Sending to Stripe with body:", formData.toString());

    const stripeRes = await fetch(stripeEndpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formData.toString(),
    });

    const stripeData = await stripeRes.json();

    if (!stripeRes.ok || !stripeData.url) {
      console.error("❌ Stripe Error Response:", stripeData);
      return new Response(JSON.stringify({
        error: stripeData.error?.message || "Stripe session creation failed"
      }), {
        status: stripeRes.status,
        headers: corsHeaders,
      });
    }

    console.log("✅ Stripe session created:", stripeData.url);

    return new Response(JSON.stringify({ url: stripeData.url }), {
      status: 200,
      headers: corsHeaders,
    });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unexpected server error";
    console.error("❌ Unexpected error:", err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});