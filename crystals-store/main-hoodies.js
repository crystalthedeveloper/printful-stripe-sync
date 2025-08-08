// main-hoodies.js

import { updateCartUI } from "https://cdn.jsdelivr.net/gh/crystalthedeveloper/printful-stripe-sync@v1.0.0/crystals-store/ui.js";
import { loadVariants, checkoutCart } from "https://cdn.jsdelivr.net/gh/crystalthedeveloper/printful-stripe-sync@v1.0.0/crystals-store/variants.js";

const STRIPE_MODE = "live"; // change to "live" when ready

document.addEventListener("DOMContentLoaded", () => {
  updateCartUI();

  setTimeout(() => {
    document.querySelectorAll(".product-block").forEach(block => {
      const productId = block.getAttribute("data-product-id")?.trim();
      const name = block.getAttribute("data-product-name")?.trim() || "Unnamed";

      if (!productId || productId.includes("{{")) return;

      const hasVariantUI =
        block.querySelector(".variant-output") &&
        block.querySelector(".color-options") &&
        block.querySelector(".size-options");

      if (hasVariantUI) {
        block.style.display = "none";
        block.offsetHeight;
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

    const checkoutBtn = document.getElementById("checkout-button");
    if (checkoutBtn) {
      checkoutBtn.addEventListener("click", () => {
        checkoutCart(STRIPE_MODE);
      });
    }
  }, 300);
});