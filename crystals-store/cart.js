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
  const price = parseFloat(variant.price) || 0;
  const id = String(variant.variant_id || variant.printful_variant_id);
  const size = variant.size || "N/A";
  const color = variant.color || "N/A";
  const stripe_price_id = variant.stripe_price_id || "";

  const existing = cart.find(item =>
    String(item.variant_id) === id &&
    item.size === size &&
    item.color === color &&
    item.stripe_price_id === stripe_price_id
  );

  if (existing) {
    existing.quantity += 1;
  } else {
    cart.push({
      variant_id: id,
      stripe_price_id,
      name: variant.name || variant.variant_name || "Unnamed Product",
      image: variant.image || variant.image_url || "",
      color,
      size,
      price,
      quantity: 1
    });
  }

  saveCart(cart);
  updateCartUI();
  const modal = document.getElementById("cart-modal");
  if (modal) modal.classList.remove("hidden");
}

export function updateQuantity(variant_id, quantity, size, color, stripe_price_id) {
  const cart = getCart();
  const item = cart.find(i =>
    String(i.variant_id) === String(variant_id) &&
    i.size === size &&
    i.color === color &&
    i.stripe_price_id === stripe_price_id
  );

  if (item) {
    item.quantity = quantity;
    if (item.quantity <= 0) {
      removeFromCart(variant_id, size, color, stripe_price_id);
    } else {
      saveCart(cart);
    }
  }

  updateCartUI();
}

export function removeFromCart(variant_id, size, color, stripe_price_id) {
  const updatedCart = getCart().filter(item =>
    !(
      String(item.variant_id) === String(variant_id) &&
      item.size === size &&
      item.color === color &&
      item.stripe_price_id === stripe_price_id
    )
  );
  saveCart(updatedCart);
  updateCartUI();
}

export function clearCart() {
  saveCart([]);
  updateCartUI();
}

export function getCartTotal() {
  return getCart().reduce((sum, item) => {
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
      const name = item.name || "Unnamed Product";
      const image = item.image || "";
      const price = parseFloat(item.price) || 0;
      const color = item.color || "N/A";
      const size = item.size || "N/A";

      const imageHTML = image.startsWith("http")
        ? `<img src="${image}" alt="${name}" class="cart-thumb" loading="lazy" style="max-width:60px; margin-right:10px;" />`
        : "";

      const div = document.createElement("div");
      div.className = "cart-item";
      div.innerHTML = `
        <div style="display:flex; align-items:center;">
          ${imageHTML}
          <div class="cart-item-details">
            <p>${name} - ${color} / ${size}</p>
            <p>
              $${price.toFixed(2)} x 
              <input type="number" min="1" value="${item.quantity}" 
                data-id="${item.variant_id}" 
                data-size="${size}" 
                data-color="${color}" 
                data-price-id="${item.stripe_price_id}"
                class="qty-input">
              <button 
                data-id="${item.variant_id}" 
                data-size="${size}" 
                data-color="${color}" 
                data-price-id="${item.stripe_price_id}"
                class="remove-item" 
                aria-label="Remove item">✕</button>
            </p>
          </div>
        </div>
      `;
      listEl.appendChild(div);
    });

    // Quantity change handler
    listEl.querySelectorAll(".qty-input").forEach(input => {
      input.addEventListener("change", () => {
        const id = input.dataset.id;
        const size = input.dataset.size;
        const color = input.dataset.color;
        const priceId = input.dataset.priceId;
        const qty = parseInt(input.value, 10);
        if (!isNaN(qty) && qty > 0) {
          updateQuantity(id, qty, size, color, priceId);
        } else {
          input.value = 1;
          updateQuantity(id, 1, size, color, priceId);
        }
      });
    });

    // Remove item handler
    listEl.querySelectorAll(".remove-item").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.id;
        const size = btn.dataset.size;
        const color = btn.dataset.color;
        const priceId = btn.dataset.priceId;
        removeFromCart(id, size, color, priceId);
      });
    });
  }
}