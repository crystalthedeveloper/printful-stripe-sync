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
        const price = parseFloat(item.price) || 0;
        const name = item.name || "Unnamed Product";
        const imageHTML = item.image
          ? `<img src="${item.image}" alt="${name}" class="cart-thumb" />`
          : "";
  
        const div = document.createElement("div");
        div.className = "cart-item";
        div.innerHTML = `
          ${imageHTML}
          <div>
            <p>${name} - ${item.color} / ${item.size}</p>
            <p>$${price.toFixed(2)} x 
              <input type="number" min="1" value="${item.quantity}" data-id="${item.variant_id}" class="qty-input">
              <button data-id="${item.variant_id}" class="remove-item">✕</button>
            </p>
          </div>
        `;
        listEl.appendChild(div);
      });
  
      // Quantity inputs
      listEl.querySelectorAll(".qty-input").forEach(input => {
        input.addEventListener("change", () => {
          const id = input.dataset.id;
          const qty = parseInt(input.value);
          updateQuantity(id, qty);
        });
      });
  
      // Remove buttons
      listEl.querySelectorAll(".remove-item").forEach(btn => {
        btn.addEventListener("click", () => removeFromCart(btn.dataset.id));
      });
    }
  }  