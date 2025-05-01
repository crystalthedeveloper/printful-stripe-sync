// create-checkout-session-template.ts

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@12.0.0";
const STRIPE_SECRET_LIVE = Deno.env.get("STRIPE_SECRET_KEY");
const STRIPE_SECRET_TEST = Deno.env.get("STRIPE_SECRET_TEST");
const corsHeaders = {
  "Access-Control-Allow-Origin": "https://www.crystalthedeveloper.ca",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json"
};
serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      status: 200,
      headers: corsHeaders
    });
  }
  const { productId, name, price, mode = "test" } = await req.json();
  if (!productId || !name || !price) {
    return new Response(JSON.stringify({
      error: "Missing product info"
    }), {
      status: 400,
      headers: corsHeaders
    });
  }
  const stripeKey = mode === "live" ? STRIPE_SECRET_LIVE : STRIPE_SECRET_TEST;
  const stripe = Stripe(stripeKey);
  const session = await stripe.checkout.sessions.create({
    payment_method_types: [
      "card"
    ],
    mode: "payment",
    customer_creation: "always",
    line_items: [
      {
        price_data: {
          currency: "cad",
          unit_amount: Math.round(price * 100),
          product_data: {
            name
          }
        },
        quantity: 1
      }
    ],
    metadata: {
      productId,
      name,
      mode
    },
    success_url: `https://www.crystalthedeveloper.ca/store/success`,
    cancel_url: `https://www.crystalthedeveloper.ca/store/cancel`
  });
  return new Response(JSON.stringify({
    url: session.url
  }), {
    status: 200,
    headers: corsHeaders
  });
});