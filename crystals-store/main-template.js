// main-template.js

const STRIPE_MODE = "live"; // ✅ Live mode for templates

document.addEventListener("DOMContentLoaded", () => {
  setTimeout(() => {
    document.querySelectorAll(".product-block-no-variants").forEach(block => {
      const productId = block.getAttribute("data-product-id")?.trim();
      const name = block.getAttribute("data-product-name")?.trim() || "Unnamed";
      const rawPrice = block.getAttribute("data-product-price")?.trim() || "0";
      const priceEl = block.querySelector(".price");

      if (!productId || productId.includes("{{")) {
        console.warn("⏳ Skipping block due to missing product data:", { productId, name });
        return;
      }

      // Format price display
      if (priceEl) {
        setTimeout(() => {
          priceEl.textContent = `$${parseFloat(rawPrice).toFixed(2)} CAD`;
          priceEl.style.display = "block";
        }, 0);
      }

      const buyBtn = block.querySelector(".buy-now-website");
      if (buyBtn) {
        buyBtn.addEventListener("click", async () => {
          try {
            const res = await fetch("https://busjhforwvqhuaivgbac.supabase.co/functions/v1/create-checkout-session-template", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                productId,
                name,
                price: parseFloat(rawPrice),
                mode: STRIPE_MODE
              })
            });

            const result = await res.json();
            if (result?.url) {
              window.location.href = result.url;
            } else {
              alert("⚠️ Failed to start checkout session.");
            }
          } catch (err) {
            console.error("❌ Template checkout error:", err);
            alert("Something went wrong during checkout.");
          }
        });
      }
    });
  }, 300);
});