/**
 * utils.js
 *
 * Shared helper functions used across Printful→Stripe sync scripts.
 * - Uses sync_variant_id (Printful store variant ID) only.
 * - Ensures accurate metadata and sync with Stripe products/prices.
 */

import fetch from "node-fetch";

// ✅ Retrieve all Stripe products with pagination
export async function getAllStripeProducts(stripe) {
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

  return products;
}

// ✅ Fetch all Printful products and their variants
export async function getPrintfulProducts() {
  const PRINTFUL_API_KEY = process.env.PRINTFUL_API_KEY;
  const listRes = await fetch("https://api.printful.com/sync/products", {
    headers: { Authorization: `Bearer ${PRINTFUL_API_KEY}` },
  });

  const listJson = await listRes.json();
  const products = [];

  for (const product of listJson.result || []) {
    const res = await fetch(`https://api.printful.com/sync/products/${product.id}`, {
      headers: { Authorization: `Bearer ${PRINTFUL_API_KEY}` },
    });

    const item = await res.json();
    const data = item.result;
    const productName = data.sync_product.name;
    const image = data.sync_product.thumbnail_url;

    for (const variant of data.sync_variants || []) {
      const title = `${productName.trim()} - ${variant.name.trim()}`;
      const metadata = {
        printful_product_name: productName,
        printful_variant_name: variant.name,
        sync_variant_id: String(variant.id), // ✅ used for fulfillment
        image_url: image,
        size: variant.size,
        color: variant.color,
      };
      products.push({ title, metadata, price: variant.retail_price });
    }
  }

  return products;
}

// ✅ Fetch single variant details via /store/variants/{id}
export async function getPrintfulVariantDetails(syncVariantId) {
  const PRINTFUL_API_KEY = process.env.PRINTFUL_API_KEY;

  const res = await fetch(`https://api.printful.com/store/variants/${syncVariantId}`, {
    headers: { Authorization: `Bearer ${PRINTFUL_API_KEY}` },
  });

  if (!res.ok) throw new Error(`Variant ID ${syncVariantId} not found in Printful`);

  const json = await res.json();
  const variant = json.result;

  const title = `${variant.product.name.trim()} - ${variant.name.trim()}`;
  const metadata = {
    printful_product_name: variant.product.name,
    printful_variant_name: variant.name,
    sync_variant_id: String(variant.id),
    image_url: variant.product.image,
    size: variant.size,
    color: variant.color,
  };

  return { title, metadata };
}

// ✅ Find or create product in Stripe by sync_variant_id or name
export async function getOrCreateProduct(stripe, title, metadata, DRY_RUN) {
  const search = await stripe.products.search({
    query: `metadata['sync_variant_id']:'${metadata.sync_variant_id}'`,
  });

  if (search.data.length > 0) {
    const existing = search.data[0];
    if (!DRY_RUN) {
      await stripe.products.update(existing.id, { name: title, metadata, active: true });
    }
    return { id: existing.id, created: false };
  }

  const list = await stripe.products.list({ limit: 100 });
  const match = list.data.find(p =>
    p.name.trim().toLowerCase() === title.trim().toLowerCase()
  );

  if (match) {
    console.log(`🛠️ Recovered via name match: ${title}`);
    if (!DRY_RUN) {
      await stripe.products.update(match.id, { metadata, active: true });
    }
    return { id: match.id, created: false };
  }

  const created = await stripe.products.create({ name: title, metadata, active: true });
  return { id: created.id, created: true };
}

// ✅ Ensure price exists and has sync_variant_id metadata
export async function ensurePriceExists(stripe, productId, price, syncVariantId, image, DRY_RUN) {
  const prices = await stripe.prices.list({ product: productId, limit: 100 });

  const expectedMetadata = {
    sync_variant_id: String(syncVariantId),
    image_url: image,
  };

  const match = prices.data.find(p =>
    p.metadata?.sync_variant_id === expectedMetadata.sync_variant_id
  );

  if (!match && !DRY_RUN) {
    await stripe.prices.create({
      product: productId,
      unit_amount: Math.round(parseFloat(price) * 100),
      currency: "cad",
      metadata: expectedMetadata,
    });
    console.log(`➕ Created price for sync_variant_id ${syncVariantId}`);
  } else if (match && !DRY_RUN) {
    await stripe.prices.update(match.id, { metadata: expectedMetadata });
    console.log(`🔁 Updated metadata on existing price: ${match.id}`);
  }
}