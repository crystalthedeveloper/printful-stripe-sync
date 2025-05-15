import { addToCart, getCart, updateCartUI } from "./cart.js";

const variantEndpoint = "https://busjhforwvqhuaivgbac.supabase.co/functions/v1/get-printful-variants";
const priceLookupEndpoint = "https://busjhforwvqhuaivgbac.supabase.co/functions/v1/lookup-stripe-price";
const checkoutEndpoint = "https://busjhforwvqhuaivgbac.supabase.co/functions/v1/create-checkout-session";

export function loadVariants(productId, blockEl, mode = "live") {
  if (!blockEl.classList.contains("product-block")) {
    console.warn("⛔ Invalid blockEl passed to loadVariants. Skipping.");
    return;
  }

  console.log("🔍 Loading variants for product ID:", productId);

  const priceEl = blockEl.querySelector(".price");
  const variantContainer = blockEl.querySelector(".variant-output");
  const colorContainer = blockEl.querySelector(".color-options");
  const sizeContainer = blockEl.querySelector(".size-options");
  const addToCartBtn = blockEl.querySelector(".add-to-cart");
  const buyNowBtn = blockEl.querySelector(".buy-now");

  // Debug log for containers
  console.log({
    blockEl,
    priceEl,
    variantContainer,
    colorContainer,
    sizeContainer,
    addToCartBtn,
    buyNowBtn
  });

  if (!variantContainer || !colorContainer || !sizeContainer || !addToCartBtn || !buyNowBtn) {
    console.warn("⚠️ Missing variant UI containers");
    if (variantContainer) {
      variantContainer.innerHTML = "<p style='color:red;'>Missing UI container elements.</p>";
    }
    return;
  }

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
    if (priceEl && variant?.retail_price) {
      priceEl.style.display = "block";
      priceEl.style.visibility = "visible";
      priceEl.textContent = `$${parseFloat(variant.retail_price).toFixed(2)} CAD`;
    }
  }

  function updatePreviewImage(variant) {
    const img = blockEl.querySelector(".variant-preview");
    if (img && variant?.image_url) {
      img.src = variant.image_url;
      img.alt = variant.variant_name;
    }
  }

  async function updateStripePriceId(variant) {
    if (variant?.stripe_price_id || !variant?.printful_product_name || !variant?.variant_name) return;
  
    const normalize = str => str?.normalize("NFKD")
      .replace(/[’']/g, "")
      .replace(/[-()_/\\|]/g, "")
      .replace(/[^\w\s]/g, "")
      .replace(/\s+/g, " ")
      .toLowerCase()
      .trim() || "";
  
    const safeProductName = `${normalize(variant.printful_product_name)} - ${normalize(variant.variant_name)}`;
    const syncVariantId = variant.sync_variant_id || variant.printful_store_variant_id;
  
    console.log("🧪 Stripe Price Lookup →", {
      safeProductName,
      syncVariantId,
      mode
    });
  
    try {
      const res = await fetch(priceLookupEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product_name: safeProductName,
          sync_variant_id: syncVariantId,
          mode
        })
      });
  
      const data = await res.json();
      console.log("🧪 Response from Stripe price lookup:", data);
      if (data?.stripe_price_id) {
        variant.stripe_price_id = data.stripe_price_id;
      } else {
        console.warn("❌ No Stripe price found for:", safeProductName, syncVariantId);
      }
    } catch (err) {
      console.error("❌ Stripe price lookup failed:", err);
    }
  }    

  async function updateButtons() {
    const matched = findMatchingVariant();
    await updateStripePriceId(matched);

    const enable = !!(matched && matched.stripe_price_id);
    buyNowBtn.disabled = !enable;
    addToCartBtn.disabled = !enable;
    buyNowBtn.classList.toggle("disabled", !enable);
    addToCartBtn.classList.toggle("disabled", !enable);

    updatePriceDisplay(matched);
    updatePreviewImage(matched);
  }

  const fullURL = `${variantEndpoint}?product_id=${productId}&mode=${mode}`;
  fetch(fullURL)
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
      colorContainer.style.display = "block";
      colorContainer.offsetHeight; // trigger reflow

      sizeContainer.innerHTML = [...sizes.entries()].map(([size, available]) =>
        `<span class="size-option option ${available ? "" : "disabled"}" data-value="${size}">${size}</span>`
      ).join("");
      sizeContainer.style.display = "block";
      sizeContainer.offsetHeight; // trigger reflow

      // Ensure mobile-safe visibility
      [colorContainer, sizeContainer, variantContainer].forEach(el => {
        el.style.display = "flex";
        el.style.flexWrap = "wrap";
        el.style.visibility = "visible";
        el.style.opacity = "1";
        el.style.maxHeight = "none";
        el.style.maxWidth = "100%";
      });

      colorContainer.querySelectorAll(".color-option:not(.disabled)").forEach(span => {
        span.addEventListener("click", async () => {
          selectedColor = span.dataset.value;
          updateSelectedStyle("color", selectedColor);
          await updateButtons();
        });
      });

      sizeContainer.querySelectorAll(".size-option:not(.disabled)").forEach(span => {
        span.addEventListener("click", async () => {
          selectedSize = span.dataset.value;
          updateSelectedStyle("size", selectedSize);
          await updateButtons();
        });
      });

      updateButtons();
    })
    .catch(err => {
      console.error("❌ Failed to load variants:", err);
    });

  addToCartBtn.addEventListener("click", async () => {
    const variant = findMatchingVariant();

    console.log("🛒 Attempting Add to Cart", {
      selectedSize,
      selectedColor,
      matchedVariant: variant
    });

    if (!variant) {
      console.warn("⚠️ No matching variant selected. Ensure both size and color are selected.");
      alert("Please select both a size and color.");
      return;
    }

    await updateStripePriceId(variant);
    console.log("🧪 Final variant after lookup:", variant);

    if (!variant?.stripe_price_id) {
      console.warn("⚠️ Add to Cart blocked — no stripe_price_id after lookup:", variant);
      alert("This product is still loading a price. Please wait a moment and try again.");
      return;
    }

    addToCart({
      variant_id: variant.sync_variant_id || variant.printful_store_variant_id,
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

  buyNowBtn.addEventListener("click", async () => {
    const variant = findMatchingVariant();
    await updateStripePriceId(variant);

    if (!variant?.stripe_price_id) {
      console.error("❌ No Stripe price ID for Buy Now:", variant);
      return;
    }

    const payload = {
      line_items: [{ price: variant.stripe_price_id, quantity: 1 }],
      currency: "CAD",
      environment: mode
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

export function checkoutCart(mode = "test") {
  const cart = getCart();

  const line_items = cart
    .filter(item => item.stripe_price_id)
    .map(item => ({
      stripe_price_id: item.stripe_price_id,
      price: item.stripe_price_id,
      quantity: item.quantity
    }));

  if (!line_items.length) {
    alert("Your cart has no valid items to checkout.");
    return;
  }

  const payload = {
    line_items,
    currency: "CAD",
    email: localStorage.getItem("user_email"),
    environment: mode
  };

  console.log("🧾 Initiating full cart checkout:", payload);

  fetch("https://busjhforwvqhuaivgbac.supabase.co/functions/v1/create-checkout-session", {
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
        alert("Checkout failed. Stripe price may be invalid.");
      }
    })
    .catch(err => {
      console.error("❌ Cart Checkout error:", err);
    });
}

// Automatically initialize variant blocks after DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.product-block[data-product-id]').forEach(block => {
      const productId = block.getAttribute('data-product-id');
      const isStatic = block.classList.contains('product-block-no-variants');
      if (productId && !isStatic) loadVariants(productId, block);
    });

    // Additional fallback logic for .product-block-no-variants
    document.querySelectorAll('.product-block-no-variants').forEach(block => {
      const priceEl = block.querySelector('.price');
      const rawPrice = block.getAttribute('data-price') || "0";

      if (priceEl) {
        if (priceEl.textContent.trim() === "") {
          priceEl.textContent = `$${parseFloat(rawPrice).toFixed(2)} CAD`;
          priceEl.style.display = "block";
        }
      }
    });
  });
} else {
  document.querySelectorAll('.product-block[data-product-id]').forEach(block => {
    const productId = block.getAttribute('data-product-id');
    const isStatic = block.classList.contains('product-block-no-variants');
    if (productId && !isStatic) loadVariants(productId, block);
  });

  // Additional fallback logic for .product-block-no-variants
  document.querySelectorAll('.product-block-no-variants').forEach(block => {
    const priceEl = block.querySelector('.price');
    const rawPrice = block.getAttribute('data-price') || "0";

    if (priceEl) {
      if (priceEl.textContent.trim() === "") {
        priceEl.textContent = `$${parseFloat(rawPrice).toFixed(2)} CAD`;
        priceEl.style.display = "block";
      }
    }
  });
}