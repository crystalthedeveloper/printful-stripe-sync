// Supabase Edge Function: stripe-webhook.ts
// Verifies Stripe webhook signature and sends order to Printful in draft mode

import { serve } from "https://deno.land/std@0.192.0/http/server.ts";

const STRIPE_SECRET_TEST = Deno.env.get("STRIPE_SECRET_TEST");
const STRIPE_WEBHOOK_SECRET_TEST = Deno.env.get("STRIPE_WEBHOOK_SECRET_TEST");
const PRINTFUL_API_KEY = Deno.env.get("PRINTFUL_API_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://www.crystalthedeveloper.ca",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Stripe-Signature",
  "Content-Type": "application/json",
};

// Type definitions
type StripeShipping = {
  name?: string;
  address?: {
    line1?: string;
    line2?: string;
    city?: string;
    state?: string;
    country?: string;
    postal_code?: string;
  };
};

type StripeCustomerDetails = {
  email?: string;
};

type StripeSession = {
  id: string;
  shipping_details?: StripeShipping;
  customer_details?: StripeCustomerDetails;
};

type StripeEvent = {
  type: "checkout.session.completed";
  data: { object: StripeSession };
};

type StripeLineItem = { quantity: number };
type StripeLineItemResponse = { data: StripeLineItem[] };

// Main handler
serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("OK", { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
  }

  if (!STRIPE_SECRET_TEST || !STRIPE_WEBHOOK_SECRET_TEST || !PRINTFUL_API_KEY) {
    console.error("❌ Missing environment variables.");
    return new Response("Server misconfiguration", { status: 500, headers: corsHeaders });
  }

  const sig = req.headers.get("Stripe-Signature");
  const bodyBuffer = await req.arrayBuffer();
  const bodyText = new TextDecoder("utf-8").decode(bodyBuffer);

  const valid = await verifyStripeSignature(bodyText, sig, STRIPE_WEBHOOK_SECRET_TEST);
  if (!valid) {
    console.error("❌ Invalid Stripe signature");
    return new Response("Invalid Stripe signature", { status: 401, headers: corsHeaders });
  }

  let event: StripeEvent;
  try {
    event = JSON.parse(bodyText);
  } catch (err) {
    console.error("❌ JSON parse error", err);
    return new Response("Invalid JSON", { status: 400, headers: corsHeaders });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;

    const itemsRes = await fetch(`https://api.stripe.com/v1/checkout/sessions/${session.id}/line_items`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${STRIPE_SECRET_TEST}`,
      },
    });

    const itemsData: StripeLineItemResponse = await itemsRes.json();
    if (!itemsRes.ok) {
      console.error("❌ Stripe item fetch error", itemsData);
      return new Response("Failed to retrieve line items", { status: 500, headers: corsHeaders });
    }

    const items = itemsData.data.map((item: StripeLineItem) => ({
      variant_id: 4012,
      quantity: item.quantity,
    }));

    const shipping = session.shipping_details;

    const printfulOrder = {
      recipient: {
        name: shipping?.name || "Customer",
        address1: shipping?.address?.line1 || "",
        address2: shipping?.address?.line2 || "",
        city: shipping?.address?.city || "",
        state_code: shipping?.address?.state || "",
        country_code: shipping?.address?.country || "CA",
        zip: shipping?.address?.postal_code || "",
        email: session.customer_details?.email || "test@example.com",
      },
      items,
      confirm: false,
    };

    const pfRes = await fetch("https://api.printful.com/orders", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PRINTFUL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(printfulOrder),
    });

    const pfData = await pfRes.json();
    if (!pfRes.ok) {
      console.error("❌ Printful error:", pfData);
      return new Response(JSON.stringify(pfData), { status: 500, headers: corsHeaders });
    }

    console.log("✅ Order sent to Printful:", pfData);
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: corsHeaders,
  });
});

// Manual timing-safe comparison
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a[i] ^ b[i];
  }
  return result === 0;
}

// Stripe Signature Verification
async function verifyStripeSignature(
  payload: string,
  sigHeader: string | null,
  secret: string
): Promise<boolean> {
  if (!sigHeader) return false;
  const parts = Object.fromEntries(sigHeader.split(",").map((p) => p.split("=")));
  const timestamp = parts["t"];
  const signature = parts["v1"];
  if (!timestamp || !signature) return false;

  const signedPayload = `${timestamp}.${payload}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signatureBuffer = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedPayload));
  const computed = new Uint8Array(signatureBuffer);
  const provided = new TextEncoder().encode(signature);

  return timingSafeEqual(computed, provided);
}