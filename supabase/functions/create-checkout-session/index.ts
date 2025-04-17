// Supabase Edge Function to create a Stripe Checkout session using HTTP fetch
import { serve } from "https://deno.land/std@0.192.0/http/server.ts";

const STRIPE_SECRET_TEST = Deno.env.get("STRIPE_SECRET_TEST");
const stripeEndpoint = "https://api.stripe.com/v1/checkout/sessions";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://www.crystalthedeveloper.ca",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json"
};

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("OK", { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
  }

  if (!STRIPE_SECRET_TEST) {
    console.error("❌ Missing Stripe secret key");
    return new Response(JSON.stringify({ error: "Missing Stripe secret key" }), {
      status: 500,
      headers: corsHeaders
    });
  }

  try {
    const { price, email }: { price: string; email?: string } = await req.json();

    if (!price) {
      return new Response(JSON.stringify({ error: "Missing price ID" }), {
        status: 400,
        headers: corsHeaders
      });
    }

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
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: formData.toString()
    });

    const stripeData = await stripeRes.json();

    if (!stripeRes.ok) {
      console.error("❌ Stripe error:", stripeData.error?.message || stripeData);
      return new Response(JSON.stringify({ error: stripeData.error?.message || "Stripe request failed" }), {
        status: 500,
        headers: corsHeaders
      });
    }

    return new Response(JSON.stringify({ url: stripeData.url }), {
      status: 200,
      headers: corsHeaders
    });

  } catch (err: unknown) {
    if (err instanceof Error) {
      console.error("❌ Runtime Error:", err.message);
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: corsHeaders
      });
    } else {
      console.error("❌ Unknown error:", err);
      return new Response(JSON.stringify({ error: "Unexpected server error" }), {
        status: 500,
        headers: corsHeaders
      });
    }
  }
});