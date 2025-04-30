// ui.js
import {
    getCart,
    getCartTotal,
    removeFromCart,
    updateQuantity
  } from "./cart.js";
  
  export function updateCartUI() {
    const cart = getCart();
    const count = cart.reduce((sum, item) => sum + item.quantity, 0);
    const total = getCartTotal();
  
    const badge = document.querySelector(".cart-badge");
    if (badge) badge.textContent = count;
  
    const totalEl = document.querySelector(".cart-total");
    if (totalEl) totalEl.textContent = `$${total} CAD`;
  
    const listEl = document.querySelector(".cart-items");
    if (listEl) {
      listEl.innerHTML = "";
  
      cart.forEach(item => {
        const name = item.name || "Unnamed Product";
        const price = parseFloat(item.price) || 0;
        const color = item.color || "N/A";
        const size = item.size || "N/A";
        const image = item.image || "";
  
        const imageHTML = image.startsWith("http")
          ? `<img src="${image}" alt="${name}" class="cart-thumb" loading="lazy" style="max-width:60px; margin-right:12px; border-radius:6px;" />`
          : "";
  
        const div = document.createElement("div");
        div.className = "cart-item";
        div.innerHTML = `
          <div style="display: flex; align-items: center;">
            ${imageHTML}
            <div class="cart-item-details">
              <p style="margin: 0 0 4px; font-weight: 500;">${name} - ${color} / ${size}</p>
              <p style="margin: 0;">
                $${price.toFixed(2)} x 
                <input type="number" min="1" value="${item.quantity}" 
                  data-id="${item.variant_id}" 
                  data-size="${size}" 
                  data-color="${color}" 
                  data-price-id="${item.stripe_price_id}" 
                  class="qty-input" style="width: 50px; margin: 0 6px;">
                <button 
                  data-id="${item.variant_id}" 
                  data-size="${size}" 
                  data-color="${color}" 
                  data-price-id="${item.stripe_price_id}"
                  class="remove-item" aria-label="Remove item" style="color: red; font-size: 16px;">✕</button>
              </p>
            </div>
          </div>
        `;
        listEl.appendChild(div);
      });
  
      // 🧮 Quantity change handler
      listEl.querySelectorAll(".qty-input").forEach(input => {
        input.addEventListener("change", () => {
          const id = input.dataset.id;
          const qty = parseInt(input.value, 10);
          const size = input.dataset.size;
          const color = input.dataset.color;
          const price_id = input.dataset.priceId;
          if (!isNaN(qty) && qty > 0) {
            updateQuantity(id, qty, size, color, price_id);
          } else {
            input.value = 1;
            updateQuantity(id, 1, size, color, price_id);
          }
        });
      });
  
      // ❌ Remove item handler
      listEl.querySelectorAll(".remove-item").forEach(btn => {
        btn.addEventListener("click", () => {
          const id = btn.dataset.id;
          const size = btn.dataset.size;
          const color = btn.dataset.color;
          const price_id = btn.dataset.priceId;
          removeFromCart(id, size, color, price_id);
        });
      });
    }
  }  