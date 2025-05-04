/**
 * utils.js
 * 
 * Shared helper functions used across Printful→Stripe sync scripts.
 * Includes:
 * - Getting all Stripe products
 * - Fetching Printful products/variants
 * - Creating or updating Stripe products
 * - Ensuring Stripe prices exist
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
        printful_variant_id: String(v.variant_id),
        printful_sync_product_id: String(p.id),
        image_url: image,
      };
      products.push({ title, metadata, price: v.retail_price });
    }
  }

  return products;
}

export async function getPrintfulVariantDetails(productId, variantId) {
  const PRINTFUL_API_KEY = process.env.PRINTFUL_API_KEY;
  const res = await fetch(`https://api.printful.com/sync/products/${productId}`, {
    headers: { Authorization: `Bearer ${PRINTFUL_API_KEY}` },
  });
  const json = await res.json();
  const product = json.result;
  const variant = product.sync_variants.find(v => v.variant_id == variantId);

  const title = `${product.sync_product.name.trim()} - ${variant.name.trim()}`;
  const metadata = {
    printful_product_name: product.sync_product.name,
    printful_variant_name: variant.name,
    printful_variant_id: String(variantId),
    image_url: product.sync_product.thumbnail_url,
    printful_sync_product_id: String(productId),
  };

  return { title, metadata };
}

export async function getOrCreateProduct(stripe, title, metadata, DRY_RUN) {
  const byMetadata = await stripe.products.search({
    query: `metadata['printful_variant_id']:'${metadata.printful_variant_id}'`,
  });

  if (byMetadata.data.length > 0) {
    const product = byMetadata.data[0];
    if (!DRY_RUN) {
      await stripe.products.update(product.id, { name: title, metadata, active: true });
    }
    return { id: product.id, created: false };
  }

  const list = await stripe.products.list({ limit: 100 });
  const matchByName = list.data.find(p => p.name.trim().toLowerCase() === title.trim().toLowerCase());

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

export async function ensurePriceExists(stripe, productId, price, variantId, image, DRY_RUN) {
  const prices = await stripe.prices.list({ product: productId, limit: 100 });
  const expectedMetadata = {
    printful_store_variant_id: String(variantId),
    image_url: image,
  };

  const existing = prices.data.find(p =>
    p.metadata?.printful_store_variant_id === expectedMetadata.printful_store_variant_id
  );

  if (!existing && !DRY_RUN) {
    await stripe.prices.create({
      product: productId,
      unit_amount: Math.round(parseFloat(price) * 100),
      currency: "cad",
      metadata: expectedMetadata,
    });
    console.log(`➕ Created price for variant ${variantId}`);
  } else if (existing && !DRY_RUN) {
    await stripe.prices.update(existing.id, { metadata: expectedMetadata });
    console.log(`🔁 Updated metadata on existing price: ${existing.id}`);
  }
}