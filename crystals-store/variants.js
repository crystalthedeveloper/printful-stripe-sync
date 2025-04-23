// variants.js

import { addToCart } from "./cart.js";
import { updateCartUI } from "./ui.js";

const endpoint = "https://busjhforwvqhuaivgbac.supabase.co/functions/v1/get-printful-variants";
const checkoutEndpoint = "https://busjhforwvqhuaivgbac.supabase.co/functions/v1/create-checkout-session";

export function loadVariants(productId, blockEl) {
  const priceEl = blockEl.querySelector(".price");
  const variantContainer = blockEl.querySelector(".variant-output");
  const colorContainer = blockEl.querySelector(".color-options");
  const sizeContainer = blockEl.querySelector(".size-options");
  const addToCartBtn = blockEl.querySelector(".add-to-cart");
  const buyNowBtn = blockEl.querySelector(".buy-now");

  if (!variantContainer || !colorContainer || !sizeContainer || !buyNowBtn || !addToCartBtn) return;

  let selectedSize = null;
  let selectedColor = null;
  let allVariants = [];

  function findMatchingVariant() {
    return allVariants.find(v =>
      v.size === selectedSize &&
      v.color === selectedColor &&
      v.available
    );
  }

  function updateSelectedStyle(type, value) {
    variantContainer.querySelectorAll(`.${type}-option`).forEach(span => {
      span.classList.toggle("selected", span.dataset.value === value);
    });
  }

  function updatePriceDisplay(variant) {
    if (!priceEl) return;
    priceEl.textContent = variant?.retail_price
      ? `$${parseFloat(variant.retail_price).toFixed(2)} CAD`
      : "$0 CAD";
  }

  function updateButtons() {
    const matched = findMatchingVariant();
    const enable = !!matched;

    buyNowBtn.disabled = !enable;
    addToCartBtn.disabled = !enable;
    buyNowBtn.classList.toggle("disabled", !enable);
    addToCartBtn.classList.toggle("disabled", !enable);

    updatePriceDisplay(matched);
  }

  fetch(`${endpoint}?product_id=${productId}`)
    .then(res => res.json())
    .then(data => {
      allVariants = data?.variants || [];
      if (!allVariants.length) {
        colorContainer.innerHTML = "<p>No colors found.</p>";
        sizeContainer.innerHTML = "<p>No sizes found.</p>";
        return;
      }

      const colors = new Map();
      const sizes = new Map();

      allVariants.forEach(v => {
        if (v.color) colors.set(v.color, v.available);
        if (v.size) sizes.set(v.size, v.available);
      });

      colorContainer.innerHTML = [...colors.entries()].map(([c, available]) =>
        `<span class="color-option option ${available ? "" : "disabled"}" data-value="${c}">${c}</span>`
      ).join("");

      sizeContainer.innerHTML = [...sizes.entries()].map(([s, available]) =>
        `<span class="size-option option ${available ? "" : "disabled"}" data-value="${s}">${s}</span>`
      ).join("");

      // Events for selecting color and size
      colorContainer.querySelectorAll(".color-option:not(.disabled)").forEach(span => {
        span.addEventListener("click", () => {
          selectedColor = span.dataset.value;
          updateSelectedStyle("color", selectedColor);
          updateButtons();
        });
      });

      sizeContainer.querySelectorAll(".size-option:not(.disabled)").forEach(span => {
        span.addEventListener("click", () => {
          selectedSize = span.dataset.value;
          updateSelectedStyle("size", selectedSize);
          updateButtons();
        });
      });

      updateButtons();
    })
    .catch(err => {
      console.error("❌ Failed to load variants:", err);
      colorContainer.innerHTML = "<p>Error loading colors.</p>";
      sizeContainer.innerHTML = "<p>Error loading sizes.</p>";
    });

  addToCartBtn.addEventListener("click", () => {
    const variant = findMatchingVariant();
    if (!variant) return;

    addToCart({
      variant_id: variant.printful_variant_id,
      stripe_price_id: variant.stripe_price_id,
      name: variant.variant_name || "No Name",
      size: variant.size,
      color: variant.color,
      price: parseFloat(variant.retail_price) || 0,
      image: variant.image_url || "" // allow empty, but handled in renderer
    });

    updateCartUI();
    const modal = document.getElementById("cart-modal");
    if (modal) modal.classList.remove("hidden");
  });

  buyNowBtn.addEventListener("click", () => {
    const variant = findMatchingVariant();
    if (!variant) return;

    fetch(checkoutEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        line_items: [{
          variant_id: variant.printful_variant_id,
          stripe_price_id: variant.stripe_price_id,
          name: variant.variant_name || "No Name",
          size: variant.size,
          color: variant.color,
          price: parseFloat(variant.retail_price) || 0,
          image: variant.image_url || "",
          quantity: 1
        }]
      })
    })
      .then(res => res.json())
      .then(data => {
        if (data?.url) window.location.href = data.url;
      })
      .catch(err => {
        console.error("❌ Checkout error:", err);
      });
  });
}