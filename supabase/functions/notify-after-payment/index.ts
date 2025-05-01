// notify-after-payment
// template

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@12.0.0";

// Change this to "live" when you're ready to go live
const MODE: string = "test"; // or "live"

const STRIPE_SECRET_TEST = Deno.env.get("STRIPE_SECRET_TEST");
const STRIPE_SECRET_LIVE = Deno.env.get("STRIPE_SECRET_KEY");
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

// ✅ Corrected the logic: use live key when MODE is "live"
const stripeKey = MODE === "live" ? STRIPE_SECRET_LIVE : STRIPE_SECRET_TEST;
const stripe = Stripe(stripeKey);

serve(async (req) => {
  const body = await req.text();

  let event;
  try {
    event = JSON.parse(body); // ⚠️ test-only – no signature verification
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  if (event?.type === "checkout.session.completed") {
    const session = event.data.object;

    const productName = session?.metadata?.name ?? "Unknown";
    const productId = session?.metadata?.productId ?? "unknown";

    // Try to get email directly from session
    let buyerEmail = session?.customer_email ?? null;

    // Fallback: fetch from Stripe
    if (!buyerEmail && session?.customer) {
      try {
        const customer = await stripe.customers.retrieve(session.customer as string);
        if (typeof customer === "object" && customer?.email) {
          buyerEmail = customer.email;
        }
      } catch (err) {
        console.error("⚠️ Error fetching Stripe customer:", err);
      }
    }

    // Send email using Resend
    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "support@crystalthedeveloper.ca",
        to: "contact@crystalthedeveloper.ca",
        subject: `🛍️ New Template Purchased: ${productName}`,
        html: `
          <p><strong>Product:</strong> ${productName}</p>
          <p><strong>Product ID:</strong> ${productId}</p>
          <p><strong>Buyer Email:</strong> ${buyerEmail ?? "N/A"}</p>
          <p>✅ You can now transfer the Webflow template link.</p>
        `,
      }),
    });

    if (!emailRes.ok) {
      console.error("❌ Email failed:", await emailRes.text());
    } else {
      console.log("✅ Email sent successfully.");
    }
  }

  return new Response("Webhook received", { status: 200 });
});