// main.js

import { updateCartUI } from "./ui.js";
import { loadVariants, checkoutCart } from "./variants.js";

// Set this to "live" for production mode
const STRIPE_MODE = "test"; // or "live"

document.addEventListener("DOMContentLoaded", () => {
    updateCartUI();
  
    setTimeout(() => {
      document.querySelectorAll(".product-block").forEach(block => {
        const productId = block.getAttribute("data-product-id")?.trim();
        const name = block.getAttribute("data-product-name")?.trim() || "Unnamed";
  
        if (!productId || productId.includes("{{")) {
          console.warn("⏳ Skipping block due to missing product data:", { productId, name });
          return;
        }
  
        console.log("✅ Initializing product:", { productId, name });
  
        // Load variants if the UI is present
        const hasVariantUI =
          block.querySelector(".variant-output") &&
          block.querySelector(".color-options") &&
          block.querySelector(".size-options");
  
        if (hasVariantUI) {
          loadVariants(productId, block);
        } else {
          console.log("ℹ️ No variant UI present, skipping loadVariants for:", productId);
        }
  
        // Buy Now (for templates, not variant-based)
        const buyBtn = block.querySelector(".buy-now-website");
        if (buyBtn) {
          buyBtn.addEventListener("click", async () => {
            try {
              const res = await fetch("https://busjhforwvqhuaivgbac.supabase.co/functions/v1/create-checkout-session-template", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ productId, name, price: 0, mode: STRIPE_MODE }) // hardcoded fallback price
              });
  
              const result = await res.json();
              if (result?.url) {
                window.location.href = result.url;
              } else {
                alert("Failed to start checkout session.");
              }
            } catch (err) {
              console.error("Checkout error:", err);
              alert("Something went wrong during checkout.");
            }
          });
        }
      });
  
      const checkoutBtn = document.getElementById("checkout-button");
      if (checkoutBtn) {
        checkoutBtn.addEventListener("click", () => {
          checkoutCart();
        });
      }
    }, 300);
  });  