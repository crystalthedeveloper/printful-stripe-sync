// Supabase Edge Function: create-checkout-session.ts
// Creates a Stripe Checkout session with Stripe API

import { serve } from "https://deno.land/std@0.192.0/http/server.ts";

// Stripe endpoint for creating Checkout Sessions
const stripeEndpoint = "https://api.stripe.com/v1/checkout/sessions";

// CORS headers
const corsHeaders = {
  "Access-Control-Allow-Origin": "https://www.crystalthedeveloper.ca",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

serve(async (req: Request): Promise<Response> => {
  // Handle preflight
  if (req.method === "OPTIONS") {
    return new Response("OK", { status: 200, headers: corsHeaders });
  }

  // Only allow POST
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
      status: 405,
      headers: corsHeaders,
    });
  }

  // Read secret after boot
  const STRIPE_SECRET_TEST = Deno.env.get("STRIPE_SECRET_TEST");

  // Check for missing env variable
  if (!STRIPE_SECRET_TEST) {
    console.error("❌ Missing STRIPE_SECRET_TEST environment variable.");
    console.error("📌 Make sure it's defined in Supabase Dashboard → Edge Functions → Secrets.");
    return new Response(JSON.stringify({ error: "Server misconfiguration" }), {
      status: 500,
      headers: corsHeaders,
    });
  }

  // Log the key prefix to verify deployment (safe for debugging)
  console.log("🔑 STRIPE_SECRET_TEST starts with:", STRIPE_SECRET_TEST.slice(0, 5));

  try {
    const contentType = req.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      return new Response(JSON.stringify({ error: "Invalid Content-Type" }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    const { price, email }: { price: string; email?: string } = await req.json();

    if (!price) {
      return new Response(JSON.stringify({ error: "Missing Stripe price ID" }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    // Build checkout session
    const formData = new URLSearchParams();
    formData.append("mode", "payment");
    formData.append("success_url", "https://www.crystalthedeveloper.ca/store/success");
    formData.append("cancel_url", "https://www.crystalthedeveloper.ca/store/cancel");
    formData.append("line_items[0][price]", price);
    formData.append("line_items[0][quantity]", "1");
    formData.append("shipping_address_collection[allowed_countries][0]", "US");
    formData.append("shipping_address_collection[allowed_countries][1]", "CA");
    if (email) formData.append("customer_email", email);

    const stripeRes = await fetch(stripeEndpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${STRIPE_SECRET_TEST}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formData.toString(),
    });

    const stripeData = await stripeRes.json();

    if (!stripeRes.ok) {
      console.error("❌ Stripe API Error:", stripeData);
      return new Response(JSON.stringify({
        error: stripeData.error?.message || "Stripe session creation failed",
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