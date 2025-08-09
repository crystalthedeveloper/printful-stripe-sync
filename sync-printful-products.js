// sync-printful-to-stripe.js
import Stripe from "stripe";
import axios from "axios";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const PRINTFUL_TOKEN = process.env.PRINTFUL_TOKEN;
const STORE_ID = process.env.PRINTFUL_STORE_ID;            // ✅ use env
if (!PRINTFUL_TOKEN || !STORE_ID) {
  throw new Error("Missing PRINTFUL_TOKEN or PRINTFUL_STORE_ID");
}

const pf = axios.create({
  baseURL: "https://api.printful.com",
  headers: { Authorization: `Bearer ${PRINTFUL_TOKEN}` }
});

async function getPrintfulProducts() {
  const { data } = await pf.get(`/stores/${STORE_ID}/products`);
  return data.result; // [{ id, external_id, name, thumbnail, ... }]
}

async function getPrintfulProduct(productId) {
  // returns { product, variants: [...] } – variants include files with preview urls
  const { data } = await pf.get(`/stores/${STORE_ID}/products/${productId}`);
  return data.result;
}

// --- NEW: pick a good image for a variant
function variantImageUrl(variant) {
  // Printful usually includes files like [{type:"preview", preview_url:...}, {type:"default", ...}]
  const fromFiles =
    variant?.files?.find(f => f.type === "preview")?.preview_url ||
    variant?.files?.find(f => f.type === "default")?.preview_url ||
    variant?.files?.[0]?.preview_url;
  // fallbacks just in case
  return fromFiles || variant?.image || variant?.preview || "";
}

async function upsertStripeProduct({ name, description, images, metadata }) {
  // prefer a stable identity via printful_external_id
  const list = await stripe.products.list({ active: true, limit: 100 });
  let product = list.data.find(p => p.metadata?.printful_external_id === metadata.printful_external_id);

  if (product) {
    return await stripe.products.update(product.id, { name, description, images, metadata });
  }
  return await stripe.products.create({ name, description, images, metadata });
}

async function upsertStripePrice(productId, { amount, currency, lookup_key, metadata }) {
  const existing = await stripe.prices.list({ product: productId, active: true, limit: 100 });
  const found = existing.data.find(pr => pr.lookup_key === lookup_key);
  if (found) return found;

  return await stripe.prices.create({
    product: productId,
    unit_amount: Math.round(Number(amount) * 100), // 90.00 -> 9000
    currency, // "cad"
    lookup_key,
    metadata // includes size, color, printful ids, image_url
  });
}

(async () => {
  const products = await getPrintfulProducts();

  for (const p of products) {
    const full = await getPrintfulProduct(p.id);
    const { product, variants } = full;

    // --- NEW: build Stripe product image gallery
    const variantImgs = (variants || [])
      .map(v => variantImageUrl(v))
      .filter(Boolean);

    const images = Array.from(
      new Set([
        product?.thumbnail,          // product-level thumbnail
        ...variantImgs.slice(0, 6)   // a few variant previews (Stripe shows up to ~8 nicely)
      ].filter(Boolean))
    );

    // 1) Create/Update Stripe Product
    const stripeProduct = await upsertStripeProduct({
      name: product?.name || p.name || "Product",
      description: product?.description || "",
      images, // <-- now includes Printful images
      metadata: {
        printful_product_id: String(product?.id ?? p.id),
        printful_external_id: product?.external_id || "",
        sku: product?.sku || ""
      }
    });

    // 2) Create/Update a Stripe Price for each variant
    for (const v of variants) {
      const retail = v?.retail_price || "90.00"; // fallback if not set
      const size = v?.size || v?.name?.match(/\b(3XL|2XL|XXL|XL|L|M|S|XS)\b/i)?.[0] || "";
      const color = v?.color || v?.color_code || "Black";
      const image_url = variantImageUrl(v);

      const baseName = (product?.name || p.name || "product").trim();
      const lookup_key = `${baseName}_${color}_${size}`.replace(/\s+/g, "-").toLowerCase();

      await upsertStripePrice(stripeProduct.id, {
        amount: retail,
        currency: "cad",
        lookup_key,
        metadata: {
          printful_variant_id: String(v?.id),
          size,
          color,
          image_url // <-- stored for your frontend
        }
      });
    }
  }

  console.log("✅ Synced Printful products, images & variant prices to Stripe");
})().catch(err => {
  console.error(err?.response?.data || err);
  process.exit(1);
});
