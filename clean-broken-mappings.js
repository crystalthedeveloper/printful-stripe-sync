// clean-printful-variants.js
// Preview Printful variants and check which are valid (no Supabase)

import dotenv from "dotenv";
import Stripe from "stripe";
dotenv.config();

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const DRY_RUN = process.env.DRY_RUN === "true";

const REQUIRED_PRODUCT_METADATA = [
  "printful_product_name",
  "printful_variant_name",
  "printful_variant_id",
  "color",
  "size",
  "image_url",
  "mode"
];

const REQUIRED_PRICE_METADATA = ["printful_store_variant_id"];

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2023-10-16" });

async function getInvalidProducts() {
  const invalid = [];

  const products = await stripe.products.list({ limit: 100 });
  for (const product of products.data) {
    const priceList = await stripe.prices.list({ product: product.id, limit: 100 });

    const missingProductMetadata = REQUIRED_PRODUCT_METADATA.filter(key => !product.metadata?.[key]);
    const invalidPrices = priceList.data.filter(
      price => REQUIRED_PRICE_METADATA.some(key => !price.metadata?.[key])
    );

    if (missingProductMetadata.length > 0 || invalidPrices.length > 0) {
      invalid.push({
        product_id: product.id,
        product_name: product.name,
        missingProductMetadata,
        invalidPriceIds: invalidPrices.map(p => p.id),
      });

      if (!DRY_RUN) {
        // Optionally delete the product and its prices
        try {
          for (const price of invalidPrices) {
            await stripe.prices.update(price.id, { active: false });
            console.log(`🧹 Deactivated price: ${price.id}`);
          }

          await stripe.products.update(product.id, { active: false });
          console.log(`🧹 Deactivated product: ${product.id}`);
        } catch (err) {
          console.error(`❌ Failed to clean up ${product.id}:`, err.message);
        }
      } else {
        console.log(`📝 Would clean: ${product.id} (${product.name})`);
      }
    }
  }

  return invalid;
}

(async function run() {
  console.log("🔍 Scanning Stripe products for missing metadata...");

  const broken = await getInvalidProducts();
  if (!broken.length) {
    console.log("✅ All products and prices have required metadata.");
  } else {
    console.log(`⚠️ ${broken.length} product(s) have metadata issues:`);
    console.table(broken.map(b => ({
      product_id: b.product_id,
      name: b.product_name,
      missing_fields: b.missingProductMetadata.join(", "),
      invalid_prices: b.invalidPriceIds.join(", ")
    })));
  }
})();