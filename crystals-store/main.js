// main.js
import { updateCartUI } from "./ui.js";
import { loadVariants, checkoutCart } from "./variants.js";

document.addEventListener("DOMContentLoaded", () => {
  // Update the cart count and totals
  updateCartUI();

  // Initialize all product blocks
  document.querySelectorAll(".product-block").forEach(block => {
    const productId = block.getAttribute("data-product-id");
    if (productId) {
      loadVariants(productId, block);
    }
  });

  // Hook up the cart checkout button
  const checkoutBtn = document.getElementById("checkout-button");
  if (checkoutBtn) {
    checkoutBtn.addEventListener("click", () => {
      checkoutCart();
    });
  }
});
