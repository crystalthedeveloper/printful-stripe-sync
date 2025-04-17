// Supabase Edge Function: stripe-webhook.ts
// Verifies Stripe webhook signature and sends order to Printful in draft mode using variant mapping

import { serve } from "https://deno.land/std@0.192.0/http/server.ts";

const STRIPE_SECRET_TEST = Deno.env.get("STRIPE_SECRET_TEST");
const STRIPE_WEBHOOK_SECRET_TEST = Deno.env.get("STRIPE_WEBHOOK_SECRET_TEST");
const PRINTFUL_API_KEY = Deno.env.get("PRINTFUL_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://www.crystalthedeveloper.ca",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Stripe-Signature",
  "Content-Type": "application/json",
};

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

type StripeCustomerDetails = { email?: string };
type StripeSession = { id: string; shipping_details?: StripeShipping; customer_details?: StripeCustomerDetails };
type StripeEvent = { type: "checkout.session.completed"; data: { object: StripeSession } };
type StripeLineItem = { quantity: number; price: { id: string } };
type StripeLineItemResponse = { data: StripeLineItem[] };

interface PrintfulFile { type: string; url: string; }
interface PrintfulVariantResponse { result?: { files?: PrintfulFile[] }; }

async function getPrintfulImageURL(variantId: number): Promise<string | null> {
  const res = await fetch(`https://api.printful.com/products/variant/${variantId}`, {
    headers: { Authorization: `Bearer ${PRINTFUL_API_KEY}` },
  });
  const data: PrintfulVariantResponse = await res.json();
  if (!res.ok || !data.result?.files) {
    console.error(`❌ Failed to fetch variant ${variantId}:`, data);
    return null;
  }
  const file = data.result.files.find((f) => f.type === "default");
  return file?.url ?? null;
}

async function getMappedVariantId(stripePriceId: string): Promise<number | null> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/variant_mappings?stripe_price_id=eq.${stripePriceId}`, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY!,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      Accept: "application/json",
    },
  });
  const data = await res.json();
  if (!res.ok || !Array.isArray(data) || data.length === 0) {
    console.error("❌ No mapping found for Stripe price ID:", stripePriceId);
    return null;
  }
  return Number(data[0].printful_variant_id);
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("OK", { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });

  if (!STRIPE_SECRET_TEST || !STRIPE_WEBHOOK_SECRET_TEST || !PRINTFUL_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("❌ Missing environment variables.");
    return new Response("Server misconfiguration", { status: 500, headers: corsHeaders });
  }

  const sig = req.headers.get("Stripe-Signature");
  const bodyBuffer = await req.arrayBuffer();
  const isValid = await verifyStripeSignature(bodyBuffer, sig, STRIPE_WEBHOOK_SECRET_TEST);
  if (!isValid) {
    console.error("❌ Invalid Stripe signature");
    return new Response("Invalid Stripe signature", { status: 401, headers: corsHeaders });
  }

  const bodyText = new TextDecoder().decode(bodyBuffer);
  let event: StripeEvent;

  try {
    event = JSON.parse(bodyText);
  } catch (err) {
    console.error("❌ JSON parse error:", err);
    return new Response("Invalid JSON", { status: 400, headers: corsHeaders });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;

    const itemsRes = await fetch(`https://api.stripe.com/v1/checkout/sessions/${session.id}/line_items`, {
      headers: { Authorization: `Bearer ${STRIPE_SECRET_TEST}` },
    });

    const itemsData: StripeLineItemResponse = await itemsRes.json();
    if (!itemsRes.ok) {
      console.error("❌ Stripe line item fetch error", itemsData);
      return new Response("Failed to fetch line items", { status: 500, headers: corsHeaders });
    }

    const items = await Promise.all(
      itemsData.data.map(async (item) => {
        const stripePriceId = item.price?.id;
        const variantId = await getMappedVariantId(stripePriceId);
        if (!variantId) return null;

        const fileUrl = await getPrintfulImageURL(variantId);
        return {
          variant_id: variantId,
          quantity: item.quantity,
          ...(fileUrl ? { files: [{ url: fileUrl }] } : {}),
        };
      })
    );

    const filteredItems = items.filter((i) => i !== null);
    if (filteredItems.length === 0) {
      console.warn("⚠️ No valid items to send to Printful.");
      return new Response("No valid items to order", { status: 200, headers: corsHeaders });
    }

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
      items: filteredItems,
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

    console.log("✅ Draft order created in Printful:", pfData);
  }

  return new Response(JSON.stringify({ received: true }), { status: 200, headers: corsHeaders });
});

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

  const parts = Object.fromEntries(sigHeader.split(",").map((p) => p.split("=")));
  const timestamp = parts["t"];
  const signature = parts["v1"];
  if (!timestamp || !signature) return false;

  const rawPayload = new TextDecoder().decode(payload);
  const signedPayload = `${timestamp}.${rawPayload}`;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signatureBuffer = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedPayload));
  const computedSignature = Array.from(new Uint8Array(signatureBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return timingSafeEqual(computedSignature, signature);
}