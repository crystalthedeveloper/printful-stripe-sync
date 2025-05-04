# 🛍️ Printful to Stripe Sync & Cleanup

This project keeps your **Stripe product catalog** in sync with your **Printful store**, supporting both **test** and **live** environments.

## 📦 Features

- ✅ Syncs Printful variants to Stripe (creates or updates)
- 🖼️ Updates product metadata, image, and pricing from Printful
- 🧹 Deletes duplicate Stripe products (by `printful_variant_id`)
- 🧪 Supports both test and live modes
- ⏰ Runs daily via GitHub Actions

---

## 📁 File Structure

```
.
├── utils.js
├── sync-printful-products.js
├── update-stripe-products.js
├── remove-stripe-duplicates.js
├── .env (or GitHub Secrets)
└── .github/
    └── workflows/
        └── sync-and-clean.yml
```

---

## 🔧 Setup

1. **Install dependencies:**

```bash
npm install
```

2. **Create a `.env` file** (or use GitHub Secrets):

```env
PRINTFUL_API_KEY=your_printful_api_key
STRIPE_SECRET_TEST=sk_test_***
STRIPE_SECRET_KEY=sk_live_***
DRY_RUN=false
```

> Alternatively, set these in GitHub under **Settings → Secrets and Variables → Actions → Repository secrets**.

---

## 🚀 Scripts

### 1. Sync Printful → Stripe

```bash
node sync-printful-products.js test
node sync-printful-products.js live
```

- Creates new Stripe products or updates existing ones.
- Ensures a Stripe price exists for each Printful variant.

---

### 2. Update Stripe Metadata

```bash
node update-stripe-products.js test
node update-stripe-products.js live
```

- Refreshes Stripe product metadata, name, and image using Printful.

---

### 3. Remove Duplicates

```bash
node remove-stripe-duplicates.js
```

- Removes older Stripe products using the same `printful_variant_id`.

---

## ⚙️ GitHub Actions (Automated Sync)

Your workflow file: `.github/workflows/sync-and-clean.yml`

Runs daily at **6 AM UTC**, or on manual trigger:

```yaml
on:
  schedule:
    - cron: '0 6 * * *'
  workflow_dispatch:
```

Includes:

- ✅ Sync (test & live)
- 🔁 Update metadata (test & live)
- 🧹 Remove duplicates (test & live)

---

## 🧠 Shared Utilities (`utils.js`)

All helper functions live here:

- `getAllStripeProducts()`
- `getPrintfulProducts()`
- `getPrintfulVariantDetails()`
- `getOrCreateProduct()`
- `ensurePriceExists()`

---

## 💡 Notes

- `DRY_RUN=true` (in `.env`) will **skip writes** to Stripe for testing.
- Printful → Stripe sync is **idempotent** (safe to run multiple times).
- Product identity is tracked using `metadata.printful_variant_id`.

---

## 🛠️ License

MIT © [Your Name]
