// Supabase Edge Function: stripe-webhook.ts
// Verifies Stripe webhook signature and sends order to Printful using sync_variant_id

import { serve } from "https://deno.land/std@0.192.0/http/server.ts";

const STRIPE_SECRET_TEST = Deno.env.get("STRIPE_SECRET_TEST");
const STRIPE_SECRET_LIVE = Deno.env.get("STRIPE_SECRET_KEY");
const STRIPE_WEBHOOK_SECRET_TEST = Deno.env.get("STRIPE_WEBHOOK_SECRET_TEST");
const STRIPE_WEBHOOK_SECRET_LIVE = Deno.env.get("STRIPE_WEBHOOK_SECRET_LIVE");
const PRINTFUL_API_KEY = Deno.env.get("PRINTFUL_API_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://www.crystalthedeveloper.ca",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Stripe-Signature",
  "Content-Type": "application/json",
};

type StripeSession = {
  id: string;
  livemode: boolean;
  shipping_details?: {
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
  customer_details?: { email?: string };
};

type StripeLineItem = {
  quantity: number;
  price: {
    id: string;
    metadata?: Record<string, string>;
  };
};

type StripeLineItemResponse = { data: StripeLineItem[] };
type StripeEvent = { type: "checkout.session.completed"; data: { object: StripeSession } };

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("OK", { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });

  const sig = req.headers.get("Stripe-Signature");
  const bodyBuffer = await req.arrayBuffer();

  const mode = sig?.includes("livemode") ? "live" : "test";
  const stripeSecret = mode === "live" ? STRIPE_SECRET_LIVE : STRIPE_SECRET_TEST;
  const stripeWebhookSecret = mode === "live" ? STRIPE_WEBHOOK_SECRET_LIVE : STRIPE_WEBHOOK_SECRET_TEST;

  if (!stripeSecret || !stripeWebhookSecret || !PRINTFUL_API_KEY) {
    console.error("❌ Missing required environment variables.");
    return new Response("Server misconfiguration", { status: 500, headers: corsHeaders });
  }

  const isValid = await verifyStripeSignature(bodyBuffer, sig, stripeWebhookSecret);
  if (!isValid) {
    console.error("❌ Invalid Stripe signature");
    return new Response("Invalid Stripe signature", { status: 401, headers: corsHeaders });
  }

  let event: StripeEvent;
  try {
    event = JSON.parse(new TextDecoder().decode(bodyBuffer));
  } catch (err) {
    console.error("❌ JSON parse error:", err);
    return new Response("Invalid JSON", { status: 400, headers: corsHeaders });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    console.log("📦 Stripe webhook received:", { mode, sessionId: session.id });

    // Fetch line items
    const itemsRes = await fetch(`https://api.stripe.com/v1/checkout/sessions/${session.id}/line_items`, {
      headers: { Authorization: `Bearer ${stripeSecret}` },
    });

    const itemsData: StripeLineItemResponse = await itemsRes.json();
    if (!itemsRes.ok) {
      console.error("❌ Failed to fetch line items:", itemsData);
      return new Response("Failed to fetch line items", { status: 500, headers: corsHeaders });
    }

    // Validate and map each line item using sync_variant_id
    const items = await Promise.all(
      itemsData.data.map(async (item) => {
        const syncVariantId = item.price?.metadata?.sync_variant_id;
        if (!syncVariantId) {
          console.warn(`⚠️ Missing sync_variant_id in metadata: ${item.price.id}`);
          return null;
        }

        const check = await fetch(`https://api.printful.com/store/variants/${syncVariantId}`, {
          headers: { Authorization: `Bearer ${PRINTFUL_API_KEY}` },
        });

        if (!check.ok) {
          console.warn(`⚠️ Printful store/variants check failed: ${syncVariantId}`);
          return null;
        }

        return {
          sync_variant_id: Number(syncVariantId),
          quantity: item.quantity,
        };
      })
    );

    const validItems = items.filter(Boolean);
    if (!validItems.length) {
      console.warn("⚠️ No valid items to fulfill — Printful order skipped.");
      return new Response("No valid items to order", { status: 200, headers: corsHeaders });
    }

    const shipping = session.shipping_details;
    const order = {
      recipient: {
        name: shipping?.name || "Customer",
        address1: shipping?.address?.line1 || "",
        address2: shipping?.address?.line2 || "",
        city: shipping?.address?.city || "",
        state_code: shipping?.address?.state || "",
        country_code: shipping?.address?.country || "CA",
        zip: shipping?.address?.postal_code || "",
        email: session.customer_details?.email || "no-reply@example.com",
      },
      items: validItems,
      confirm: false,
    };

    const pfRes = await fetch("https://api.printful.com/orders", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PRINTFUL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(order),
    });

    const pfData = await pfRes.json();
    if (!pfRes.ok) {
      console.error("❌ Printful order failed:", pfData);
      return new Response(JSON.stringify(pfData), { status: 500, headers: corsHeaders });
    }

    console.log("✅ Printful draft order created:", pfData.id || pfData);
  }

  return new Response(JSON.stringify({ received: true }), { status: 200, headers: corsHeaders });
});

// Stripe Signature Verification
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

async function verifyStripeSignature(
  payload: ArrayBuffer,
  sigHeader: string | null,
  secret: string
): Promise<boolean> {
  if (!sigHeader) return false;

  const parts = Object.fromEntries(sigHeader.split(",").map(p => p.split("=")));
  const timestamp = parts["t"];
  const signature = parts["v1"];
  if (!timestamp || !signature) return false;

  const signedPayload = `${timestamp}.${new TextDecoder().decode(payload)}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signatureBuffer = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedPayload));
  const computedSignature = Array.from(new Uint8Array(signatureBuffer))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");

  return timingSafeEqual(computedSignature, signature);
}