// Supabase Edge Function: create-checkout-session.ts
// Creates a Stripe Checkout session with Stripe API

import { serve } from "https://deno.land/std@0.192.0/http/server.ts";

const stripeEndpoint = "https://api.stripe.com/v1/checkout/sessions";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://www.crystalthedeveloper.ca",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

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

  const STRIPE_SECRET_TEST = Deno.env.get("STRIPE_SECRET_TEST");
  if (!STRIPE_SECRET_TEST) {
    return new Response(JSON.stringify({ error: "Missing Stripe secret" }), {
      status: 500,
      headers: corsHeaders,
    });
  }

  try {
    const { 
      line_items, 
      email, 
      mode = "payment", 
      currency = "CAD", 
      success_url = "https://www.crystalthedeveloper.ca/store/success", 
      cancel_url = "https://www.crystalthedeveloper.ca/store/cancel", 
      shipping_countries = ["US", "CA"]
    } = await req.json();

    if (!Array.isArray(line_items) || line_items.length === 0) {
      return new Response(JSON.stringify({ error: "Missing line_items" }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    const formData = new URLSearchParams();
    formData.append("mode", mode);
    formData.append("success_url", success_url);
    formData.append("cancel_url", cancel_url);
    formData.append("currency", currency);

    line_items.forEach((item: any, index: number) => {
      const priceId = item.price || item.stripe_price_id;
      if (!priceId) return;

      formData.append(`line_items[${index}][price]`, priceId);
      formData.append(`line_items[${index}][quantity]`, String(item.quantity || 1));

      const description = [
        item.name && `Name: ${item.name}`,
        item.color && `Color: ${item.color}`,
        item.size && `Size: ${item.size}`,
        item.image && `Image: ${item.image}`
      ].filter(Boolean).join(" | ");

      if (description) {
        formData.append(`line_items[${index}][description]`, description);
      }
    });

    shipping_countries.forEach((code: string, i: number) => {
      formData.append(`shipping_address_collection[allowed_countries][${i}]`, code);
    });

    if (email) {
      formData.append("customer_email", email);
    }

    const stripeRes = await fetch(stripeEndpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${STRIPE_SECRET_TEST}`,
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

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unexpected server error";
    console.error("❌ Unexpected error:", err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});