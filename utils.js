/**
 * utils.js
 *
 * Shared helper functions used across Printful→Stripe sync scripts.
 * - Ensures consistent `stripe_product_name` used across all metadata and lookups.
 */

import fetch from "node-fetch";

// Fetch all Stripe products
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

// Fetch all Printful sync products and their variants
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
      const composedName = `${productName.trim()} - ${variant.name.trim()}`; // 👈 Used consistently

      const metadata = {
        printful_product_name: productName,
        printful_variant_name: variant.name,
        stripe_product_name: composedName, // 👈 Added here for Stripe match
        sync_variant_id: String(variant.id),
        sku: variant.sku,
        image_url: image,
        size: variant.size,
        color: variant.color,
      };

      products.push({ title: composedName, metadata, price: variant.retail_price });
    }
  }

  return products;
}

// Fetch a single variant’s detailed info from Printful
export async function getPrintfulVariantDetails(syncVariantId) {
  const PRINTFUL_API_KEY = process.env.PRINTFUL_API_KEY;
  const res = await fetch(`https://api.printful.com/store/variants/${syncVariantId}`, {
    headers: { Authorization: `Bearer ${PRINTFUL_API_KEY}` },
  });

  if (!res.ok) throw new Error(`Variant ${syncVariantId} not found in Printful`);

  const json = await res.json();
  const variant = json.result;

  const composedName = `${variant.product.name.trim()} - ${variant.name.trim()}`;

  const metadata = {
    printful_product_name: variant.product.name,
    printful_variant_name: variant.name,
    stripe_product_name: composedName,
    sync_variant_id: String(variant.id),
    sku: variant.sku,
    image_url: variant.product.image,
    size: variant.size,
    color: variant.color,
  };

  return { title: composedName, metadata };
}

// Get or create a product in Stripe based on sync_variant_id or composed name
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
    console.log(`🛠️ Recovered by name: ${title}`);
    if (!DRY_RUN) {
      await stripe.products.update(match.id, { metadata, active: true });
    }
    return { id: match.id, created: false };
  }

  const created = await stripe.products.create({ name: title, metadata, active: true });
  return { id: created.id, created: true };
}

// Ensure Stripe price exists and is up-to-date and only one is active
export async function ensurePriceExists(stripe, productId, price, syncVariantId, image, DRY_RUN) {
  const prices = await stripe.prices.list({ product: productId, limit: 100 });

  const expectedMetadata = {
    sync_variant_id: String(syncVariantId),
    image_url: image,
  };

  const existing = prices.data.find(p =>
    p.metadata?.sync_variant_id === expectedMetadata.sync_variant_id
  );

  if (existing) {
    if (!DRY_RUN) {
      await stripe.prices.update(existing.id, {
        metadata: expectedMetadata,
        active: true,
      });
    }
    console.log(`🔁 Updated existing price: ${existing.id}`);
  } else {
    if (!DRY_RUN) {
      const created = await stripe.prices.create({
        product: productId,
        unit_amount: Math.round(parseFloat(price) * 100),
        currency: "cad",
        metadata: expectedMetadata,
      });
      console.log(`➕ Created new price: ${created.id}`);
    }
  }

  for (const p of prices.data) {
    if (p.metadata?.sync_variant_id !== expectedMetadata.sync_variant_id && p.active) {
      if (!DRY_RUN) {
        await stripe.prices.update(p.id, { active: false });
      }
      console.log(`🗑️ Deactivated extra price: ${p.id}`);
    }
  }
}