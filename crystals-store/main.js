// main.js

import { updateCartUI } from "https://cdn.jsdelivr.net/gh/crystalthedeveloper/printful-stripe-sync@v0.2.0/crystals-store/ui.js";
import { loadVariants, checkoutCart } from "https://cdn.jsdelivr.net/gh/crystalthedeveloper/printful-stripe-sync@v0.2.0/crystals-store/variants.js";

// Set this to "live" for production mode
const STRIPE_MODE = "test"; // or "live"

document.addEventListener("DOMContentLoaded", () => {
  updateCartUI();

  setTimeout(() => {
    // 🔁 Handle variant-based products
    document.querySelectorAll(".product-block").forEach(block => {
      const productId = block.getAttribute("data-product-id")?.trim();
      const name = block.getAttribute("data-product-name")?.trim() || "Unnamed";

      if (!productId || productId.includes("{{")) {
        console.warn("⏳ Skipping block due to missing product data:", { productId, name });
        return;
      }

      console.log("✅ Initializing product:", { productId, name });

      const hasVariantUI =
        block.querySelector(".variant-output") &&
        block.querySelector(".color-options") &&
        block.querySelector(".size-options");

      if (hasVariantUI) {
        // Force layout reflow to fix mobile rendering issues
        block.style.display = "none";
        block.offsetHeight; // trigger reflow
        block.style.display = "";

        loadVariants(productId, block, STRIPE_MODE);

        setTimeout(() => {
          const variantSection = block.querySelector(".variant-output");
          if (variantSection) {
            variantSection.style.display = "flex";
            variantSection.style.visibility = "visible";
          }
        }, 100);
      }
    });

    // ⚡ Handle static/template products (no variants)
    document.querySelectorAll(".product-block-no-variants").forEach(block => {
      const productId = block.getAttribute("data-product-id")?.trim();
      const name = block.getAttribute("data-product-name")?.trim() || "Unnamed";
      const rawPrice = block.getAttribute("data-product-price")?.trim() || "0";
      const priceEl = block.querySelector(".price");

      if (!productId || productId.includes("{{")) {
        console.warn("⏳ Skipping static block due to missing product data:", { productId, name });
        return;
      }

      // Format the price text
      if (priceEl) {
        setTimeout(() => {
          priceEl.textContent = `$${parseFloat(rawPrice).toFixed(2)} CAD`;
          priceEl.style.display = "block";
        }, 0);
      }

      const buyBtn = block.querySelector(".buy-now-website");
      if (buyBtn) {
        buyBtn.addEventListener("click", async () => {
          try {
            const res = await fetch("https://busjhforwvqhuaivgbac.supabase.co/functions/v1/create-checkout-session-template", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                productId,
                name,
                price: parseFloat(rawPrice),
                mode: STRIPE_MODE
              })
            });

            const result = await res.json();
            if (result?.url) {
              window.location.href = result.url;
            } else {
              alert("⚠️ Failed to start checkout session.");
            }
          } catch (err) {
            console.error("❌ Static product checkout error:", err);
            alert("Something went wrong during checkout.");
          }
        });
      }
    });

    // 🛒 Handle global cart checkout
    const checkoutBtn = document.getElementById("checkout-button");
    if (checkoutBtn) {
      checkoutBtn.addEventListener("click", () => {
        checkoutCart(STRIPE_MODE);
      });
    }
  }, 300);
});