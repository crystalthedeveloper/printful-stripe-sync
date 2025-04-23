// main.js
import { updateCartUI } from "./ui.js";
import { loadVariants } from "./variants.js";

document.addEventListener("DOMContentLoaded", () => {
  updateCartUI();
  document.querySelectorAll(".product-block").forEach(block => {
    const productId = block.getAttribute("data-product-id");
    if (productId) loadVariants(productId, block);
  });
});