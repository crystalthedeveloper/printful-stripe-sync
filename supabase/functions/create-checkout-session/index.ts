// create-checkout-session.ts — Stripe + Printful Only (No Supabase)
import { serve } from "https://deno.land/std@0.192.0/http/server.ts";

const STRIPE_SECRET_TEST = Deno.env.get("STRIPE_SECRET_TEST");
const STRIPE_SECRET_LIVE = Deno.env.get("STRIPE_SECRET_KEY");
const stripeEndpoint = "https://api.stripe.com/v1/checkout/sessions";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://www.crystalthedeveloper.ca",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json"
};

serve(async (req) => {
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
      environment = "live", // 👈 dynamic mode support from payload
      success_url = "https://www.crystalthedeveloper.ca/store/success",
      cancel_url = "https://www.crystalthedeveloper.ca/store/cancel",
      shipping_countries = ["US", "CA"]
    } = await req.json();

    if (!Array.isArray(line_items) || line_items.length === 0) {
      return new Response(JSON.stringify({ error: "Missing or invalid line_items" }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    const STRIPE_SECRET_KEY = environment === "live" ? STRIPE_SECRET_LIVE : STRIPE_SECRET_TEST;

    if (!STRIPE_SECRET_KEY) {
      return new Response(JSON.stringify({ error: `Missing Stripe secret for ${environment}` }), {
        status: 500,
        headers: corsHeaders,
      });
    }

    const formData = new URLSearchParams();
    formData.append("mode", "payment");
    formData.append("success_url", success_url);
    formData.append("cancel_url", cancel_url);
    formData.append("payment_method_types[0]", "card");

    let validItems = 0;
    line_items.forEach((item, index) => {
      const priceId = item.price || item.stripe_price_id;
      if (!priceId) {
        console.warn(`⚠️ Skipping item without price ID at index ${index}`, item);
        return;
      }
      formData.append(`line_items[${index}][price]`, priceId);
      formData.append(`line_items[${index}][quantity]`, String(item.quantity || 1));
      validItems++;
    });

    if (validItems === 0) {
      return new Response(JSON.stringify({ error: "No valid Stripe price IDs in line_items" }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    shipping_countries.forEach((code: string, i: number) => {
      formData.append(`shipping_address_collection[allowed_countries][${i}]`, code);
    });

    if (email) {
      formData.append("customer_email", email);
    }

    formData.append("metadata[mode]", environment);

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
      console.error("❌ Stripe Error:", stripeData);
      return new Response(JSON.stringify({
        error: stripeData.error?.message || "Stripe session creation failed"
      }), {
        status: stripeRes.status,
        headers: corsHeaders,
      });
    }

    return new Response(JSON.stringify({ url: stripeData.url }), {
      status: 200,
      headers: corsHeaders,
    });

  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected server error";
    console.error("❌ Unexpected error:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});