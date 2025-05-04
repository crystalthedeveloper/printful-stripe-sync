/**
 * utils.js
 *
 * Shared helper functions used across Printful→Stripe sync scripts.
 * - Uses sync_variant_id (Printful store variant ID) only.
 * - Ensures accurate metadata and sync with Stripe products/prices.
 */

import fetch from "node-fetch";

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

export async function getPrintfulProducts() {
  const PRINTFUL_API_KEY = process.env.PRINTFUL_API_KEY;
  const listRes = await fetch("https://api.printful.com/sync/products", {
    headers: { Authorization: `Bearer ${PRINTFUL_API_KEY}` },
  });

  const listJson = await listRes.json();
  const products = [];

  for (const p of listJson.result || []) {
    const res = await fetch(`https://api.printful.com/sync/products/${p.id}`, {
      headers: { Authorization: `Bearer ${PRINTFUL_API_KEY}` },
    });

    const item = await res.json();
    const data = item.result;
    const productName = data.sync_product.name;
    const image = data.sync_product.thumbnail_url;

    for (const v of data.sync_variants || []) {
      const title = `${productName.trim()} - ${v.name.trim()}`;
      const metadata = {
        printful_product_name: productName,
        printful_variant_name: v.name,
        sync_variant_id: String(v.id), // ✅ correct global ID
        image_url: image,
        size: v.size,
        color: v.color,
      };
      products.push({ title, metadata, price: v.retail_price });
    }
  }

  return products;
}

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

export async function getOrCreateProduct(stripe, title, metadata, DRY_RUN) {
  const byMetadata = await stripe.products.search({
    query: `metadata['sync_variant_id']:'${metadata.sync_variant_id}'`,
  });

  if (byMetadata.data.length > 0) {
    const product = byMetadata.data[0];
    if (!DRY_RUN) {
      await stripe.products.update(product.id, { name: title, metadata, active: true });
    }
    return { id: product.id, created: false };
  }

  const list = await stripe.products.list({ limit: 100 });
  const matchByName = list.data.find(p =>
    p.name.trim().toLowerCase() === title.trim().toLowerCase()
  );

  if (matchByName) {
    console.log(`🛠️ Recovered via name match: ${title}`);
    if (!DRY_RUN) {
      await stripe.products.update(matchByName.id, { metadata, active: true });
    }
    return { id: matchByName.id, created: false };
  }

  const created = await stripe.products.create({ name: title, metadata, active: true });
  return { id: created.id, created: true };
}

export async function ensurePriceExists(stripe, productId, price, syncVariantId, image, DRY_RUN) {
  const prices = await stripe.prices.list({ product: productId, limit: 100 });
  const expectedMetadata = {
    sync_variant_id: String(syncVariantId), // ✅ used by webhook
    image_url: image,
  };

  const existing = prices.data.find(p =>
    p.metadata?.sync_variant_id === expectedMetadata.sync_variant_id
  );

  if (!existing && !DRY_RUN) {
    await stripe.prices.create({
      product: productId,
      unit_amount: Math.round(parseFloat(price) * 100),
      currency: "cad",
      metadata: expectedMetadata,
    });
    console.log(`➕ Created price for sync_variant_id ${syncVariantId}`);
  } else if (existing && !DRY_RUN) {
    await stripe.prices.update(existing.id, { metadata: expectedMetadata });
    console.log(`🔁 Updated metadata on existing price: ${existing.id}`);
  }
}