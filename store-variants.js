// store-variants.js
const endpoint = "https://busjhforwvqhuaivgbac.supabase.co/functions/v1/get-printful-variants";
const checkoutEndpoint = "https://busjhforwvqhuaivgbac.supabase.co/functions/v1/create-checkout-session";

function updateSelectedStyle(container, type, value) {
    container.querySelectorAll(`.${type}-option`).forEach(span => {
        span.classList.toggle("selected", span.dataset.value === value);
    });
}

function updatePriceDisplay(variant, priceEl) {
    if (!priceEl) return;
    if (variant?.retail_price) {
        const price = parseFloat(variant.retail_price);
        priceEl.textContent = isNaN(price) ? "$0 CAD" : `$${price.toFixed(2)} CAD`;
    } else {
        priceEl.textContent = "$0 CAD";
    }
}

function loadVariants(productId, blockEl) {
    const priceEl = blockEl.querySelector(".price");
    const variantContainer = blockEl.querySelector(".variant-output");
    const colorContainer = blockEl.querySelector(".color-options");
    const sizeContainer = blockEl.querySelector(".size-options");
    const buyBtn = blockEl.querySelector(".button");

    if (!variantContainer || !colorContainer || !sizeContainer || !buyBtn) return;

    let selectedSize = null;
    let selectedColor = null;
    let allVariants = [];

    const checkBuyNowAvailability = () => {
        const matched = allVariants.find(v =>
            v.size === selectedSize && v.color === selectedColor && v.available
        );

        if (matched) {
            buyBtn.disabled = false;
            buyBtn.classList.remove("disabled");
            updatePriceDisplay(matched, priceEl);
        } else {
            buyBtn.disabled = true;
            buyBtn.classList.add("disabled");
            updatePriceDisplay(null, priceEl);
        }
    };

    fetch(`${endpoint}?product_id=${productId}`)
        .then(res => res.json())
        .then(data => {
            selectedSize = null;
            selectedColor = null;
            allVariants = data.variants || [];

            if (!allVariants.length) {
                colorContainer.innerHTML = "<p>No colors found.</p>";
                sizeContainer.innerHTML = "<p>No sizes found.</p>";
                return;
            }

            const colors = new Map();
            const sizes = new Map();

            allVariants.forEach(v => {
                if (v.color && !colors.has(v.color)) colors.set(v.color, v.available);
                if (v.size && !sizes.has(v.size)) sizes.set(v.size, v.available);
            });

            colorContainer.innerHTML = [...colors.entries()]
                .map(([c, available]) =>
                    `<span class="color-option option ${available ? "" : "disabled"}" data-value="${c}">${c}</span>`
                ).join("");

            sizeContainer.innerHTML = [...sizes.entries()]
                .map(([s, available]) =>
                    `<span class="size-option option ${available ? "" : "disabled"}" data-value="${s}">${s}</span>`
                ).join("");

            colorContainer.querySelectorAll(".color-option").forEach(span => {
                if (!span.classList.contains("disabled")) {
                    span.addEventListener("click", () => {
                        selectedColor = span.dataset.value;
                        updateSelectedStyle(variantContainer, "color", selectedColor);
                        checkBuyNowAvailability();
                    });
                }
            });

            sizeContainer.querySelectorAll(".size-option").forEach(span => {
                if (!span.classList.contains("disabled")) {
                    span.addEventListener("click", () => {
                        selectedSize = span.dataset.value;
                        updateSelectedStyle(variantContainer, "size", selectedSize);
                        checkBuyNowAvailability();
                    });
                }
            });

            checkBuyNowAvailability();
        })
        .catch(err => {
            console.error("Error loading variants:", err);
            colorContainer.innerHTML = "<p>Failed to load colors.</p>";
            sizeContainer.innerHTML = "<p>Failed to load sizes.</p>";
        });

    buyBtn.addEventListener("click", () => {
        const selected = allVariants.find(
            v => v.size === selectedSize && v.color === selectedColor && v.available
        );

        if (selected?.stripe_price_id) {
            fetch(checkoutEndpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ price: selected.stripe_price_id })
            })
                .then(res => res.json())
                .then(data => {
                    if (data?.url) {
                        window.location.href = data.url;
                    } else {
                        alert("Could not start checkout.");
                    }
                })
                .catch(err => {
                    console.error("Checkout error:", err);
                    alert("Error starting checkout.");
                });
        } else {
            alert("No matching variant selected.");
        }
    });
}

document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll(".product-block").forEach((blockEl) => {
        const productId = blockEl.getAttribute("data-product-id");
        if (productId) loadVariants(productId, blockEl);
    });
});