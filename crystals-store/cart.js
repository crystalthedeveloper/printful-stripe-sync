// cart.js
const CART_KEY = "crystals_store_cart";

export function getCart() {
  try {
    return JSON.parse(localStorage.getItem(CART_KEY)) || [];
  } catch {
    return [];
  }
}

export function saveCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
}

export function addToCart(variant) {
  const cart = getCart();
  const existing = cart.find(item => item.variant_id === variant.variant_id);
  const price = parseFloat(variant.price) || 0;

  if (existing) {
    existing.quantity += 1;
  } else {
    cart.push({ ...variant, price, quantity: 1 });
  }

  saveCart(cart);
  updateCartUI();

  // Show cart modal
  const modal = document.getElementById("cart-modal");
  if (modal) modal.classList.remove("hidden");
}

export function updateQuantity(variant_id, quantity) {
  const cart = getCart();
  const item = cart.find(i => i.variant_id === variant_id);
  if (item) {
    item.quantity = quantity;
    if (item.quantity <= 0) {
      removeFromCart(variant_id);
      return;
    }
    saveCart(cart);
    updateCartUI();
  }
}

export function removeFromCart(variant_id) {
  const cart = getCart().filter(item => item.variant_id !== variant_id);
  saveCart(cart);
  updateCartUI();
}

export function clearCart() {
  saveCart([]);
  updateCartUI();
}

export function getCartTotal() {
  const cart = getCart();
  return cart.reduce((sum, item) => {
    const price = parseFloat(item.price) || 0;
    return sum + price * item.quantity;
  }, 0).toFixed(2);
}

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
      const imageTag = item.image?.startsWith("http")
        ? `<img src="${item.image}" alt="${name}" class="cart-thumb" />`
        : ""; // ✅ Prevent rendering broken image tag

      const div = document.createElement("div");
      div.className = "cart-item";
      div.innerHTML = `
        ${imageTag}
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

    listEl.querySelectorAll(".qty-input").forEach(input => {
      input.addEventListener("change", () => {
        const id = input.dataset.id;
        const qty = parseInt(input.value);
        updateQuantity(id, qty);
      });
    });

    listEl.querySelectorAll(".remove-item").forEach(btn => {
      btn.addEventListener("click", () => removeFromCart(btn.dataset.id));
    });
  }
}