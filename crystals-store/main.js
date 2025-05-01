// main.js

import { updateCartUI } from "./ui.js";
import { loadVariants, checkoutCart } from "./variants.js";

// Set this to "live" for production mode
const STRIPE_MODE = "test"; // or "live"

document.addEventListener("DOMContentLoaded", () => {
  // Update the cart count and totals
  updateCartUI();

  // Loop through all product blocks
  document.querySelectorAll(".product-block").forEach(block => {
    const productId = block.getAttribute("data-product-id");
    const name = block.getAttribute("data-product-name");
    const price = parseFloat(block.getAttribute("data-product-price"));

    if (!productId || !name || isNaN(price)) return;

    // Load variant data if applicable
    loadVariants(productId, block);

    // Update visible price
    const priceEl = block.querySelector(".price");
    if (priceEl) priceEl.textContent = `$${price.toFixed(2)} CAD`;

    // Attach Buy Now click handler
    const buyBtn = block.querySelector(".buy-now-website");
    if (buyBtn) {
      buyBtn.addEventListener("click", async () => {
        try {
          const res = await fetch("https://busjhforwvqhuaivgbac.supabase.co/functions/v1/create-checkout-session-template", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ productId, name, price, mode: STRIPE_MODE })
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

  // Hook up the cart checkout button (if you're using a separate cart system)
  const checkoutBtn = document.getElementById("checkout-button");
  if (checkoutBtn) {
    checkoutBtn.addEventListener("click", () => {
      checkoutCart();
    });
  }
});