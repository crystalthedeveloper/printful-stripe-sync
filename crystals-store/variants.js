// variants.js

import { addToCart, getCart, updateCartUI } from "./cart.js";

const isTest = true;

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
      (v.available ?? true)
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

  function updatePreviewImage(variant) {
    const img = blockEl.querySelector(".variant-preview");
    if (img && variant?.image_url) {
      img.src = variant.image_url;
      img.alt = variant.variant_name;
    }
  }

  function updateButtons() {
    const matched = findMatchingVariant();
    const enable = !!matched;

    buyNowBtn.disabled = !enable;
    addToCartBtn.disabled = !enable;
    buyNowBtn.classList.toggle("disabled", !enable);
    addToCartBtn.classList.toggle("disabled", !enable);

    updatePriceDisplay(matched);
    updatePreviewImage(matched);
  }

  fetch(`${endpoint}?product_id=${productId}&mode=${isTest ? "test" : "live"}`)
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
        if (v.color) colors.set(v.color, v.available ?? true);
        if (v.size) sizes.set(v.size, v.available ?? true);
      });

      colorContainer.innerHTML = [...colors.entries()].map(([color, available]) =>
        `<span class="color-option option ${available ? "" : "disabled"}" data-value="${color}">${color}</span>`
      ).join("");

      sizeContainer.innerHTML = [...sizes.entries()].map(([size, available]) =>
        `<span class="size-option option ${available ? "" : "disabled"}" data-value="${size}">${size}</span>`
      ).join("");

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
    });

  addToCartBtn.addEventListener("click", () => {
    const variant = findMatchingVariant();
    if (!variant || !variant.stripe_price_id) {
      console.warn("⚠️ No Stripe price ID on Add to Cart variant:", variant);
      return;
    }

    addToCart({
      variant_id: variant.printful_store_variant_id,
      stripe_price_id: variant.stripe_price_id,
      name: variant.variant_name || "Unnamed Product",
      image: variant.image_url || "",
      size: variant.size || "N/A",
      color: variant.color || "N/A",
      price: parseFloat(variant.retail_price) || 0
    });

    updateCartUI();
    const modal = document.getElementById("cart-modal");
    if (modal) modal.classList.remove("hidden");
  });

  buyNowBtn.addEventListener("click", () => {
    const variant = findMatchingVariant();
    if (!variant || !variant.stripe_price_id) {
      console.error("❌ No valid Stripe price ID for selected variant:", variant);
      return;
    }

    const payload = {
      line_items: [{
        price: variant.stripe_price_id,
        quantity: 1
      }],
      currency: "CAD",
      environment: isTest ? "test" : "live"
    };

    fetch(checkoutEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    })
      .then(res => res.json())
      .then(data => {
        if (data?.url) {
          window.location.href = data.url;
        } else {
          console.error("❌ No URL returned from checkout session:", data);
        }
      })
      .catch(err => {
        console.error("❌ Checkout error:", err);
      });
  });
}

export function checkoutCart() {
  const cart = getCart();
  const line_items = cart.map(item => ({
    price: item.stripe_price_id,
    quantity: item.quantity
  }));

  const payload = {
    line_items,
    currency: "CAD",
    email: localStorage.getItem("user_email"),
    environment: isTest ? "test" : "live"
  };

  fetch(checkoutEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  })
    .then(res => res.json())
    .then(data => {
      if (data?.url) {
        window.location.href = data.url;
      } else {
        console.error("❌ Stripe session URL not returned. Response:", data);
      }
    })
    .catch(err => {
      console.error("❌ Cart Checkout error:", err);
    });
}