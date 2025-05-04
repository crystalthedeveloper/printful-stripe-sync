import dotenv from "dotenv";
import Stripe from "stripe";

dotenv.config();

const MODE = process.argv[2] || process.env.MODE || "test";
const STRIPE_KEY =
  MODE === "live" ? process.env.STRIPE_SECRET_KEY : process.env.STRIPE_SECRET_TEST;

if (!STRIPE_KEY) throw new Error(`❌ Missing Stripe key for mode: ${MODE.toUpperCase()}`);

const stripe = new Stripe(STRIPE_KEY, { apiVersion: "2023-10-16" });

async function run() {
  console.log(`🚨 Cleaning up printful_variant_id from Stripe products (${MODE.toUpperCase()} mode)`);

  const products = [];
  let hasMore = true;
  let starting_after;

  while (hasMore) {
    const res = await stripe.products.list({ limit: 100, starting_after });
    products.push(...res.data);
    hasMore = res.has_more;
    if (res.data.length > 0) {
      starting_after = res.data[res.data.length - 1].id;
    }
  }

  if (!products.length) {
    console.log("⚠️ No products found.");
    return;
  }

  let updated = 0;
  for (const product of products) {
    const metadata = { ...product.metadata };
    if ("printful_variant_id" in metadata) {
      delete metadata.printful_variant_id;
      await stripe.products.update(product.id, { metadata });
      console.log(`✅ Removed from: ${product.name} (${product.id})`);
      updated++;
    }
  }

  console.log(`🎉 Done. ${updated} product(s) cleaned in ${MODE.toUpperCase()} mode.`);
}

run().catch((err) => {
  console.error("❌ Error:", err.message);
});