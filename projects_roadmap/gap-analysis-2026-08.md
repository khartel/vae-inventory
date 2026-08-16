# Gap analysis: VAE Inventory vs. "world-class" inventory management software

Prompted by Victor sharing a feature checklist sourced from general ecommerce-inventory-management advice, plus Fishbowl's blog post (fishbowlinventory.com/blog/e-commerce-inventory-management-techniques-and-software). Goal: figure out which of those ideas genuinely apply to VAE Inventory's actual business (a family-run, in-person, small physical retail/wholesale shop with walk-in and credit customers — see `phase-00-analysis.md` §1), which don't, and produce a prioritized plan for the ones that do.

**Read this before `phases/phase-g-*.md` onward** — those phases exist because of the conclusions here.

## The honest framing first

Fishbowl (and most of the "best inventory software" advice on the web) is written for a different kind of business than VAE Inventory serves: **multi-channel ecommerce sellers** (Shopify/Amazon/eBay), **light manufacturers** (bill of materials, work orders), and **3PL warehouses** shipping parcels to strangers. A meaningful chunk of their feature checklist is built for problems VAE Inventory's actual users don't have — and per this project's own founding decision (`decisions.md` ADR-1: "don't introduce infrastructure/complexity this project doesn't need"), adopting those features wholesale would be a mistake, not a strength.

But underneath the ecommerce-specific packaging, a real, transferable core of "what makes inventory software good" applies to any inventory-holding business — physical or online. That core is what this analysis extracts.

## Where VAE Inventory already matches or beats the checklist

Don't rebuild these — they're already there, and in some cases go further than typical small-business tools:

| Checklist item | VAE Inventory today |
|---|---|
| Real-time inventory tracking | Live stock per warehouse, decremented atomically on sale (`$transaction`), no batch/nightly sync |
| Low-stock alerts | Better than most: a live, Settings-configurable per-unit rule (not a static per-product number set once) — see `completed.md`, 2026-08-05 |
| Multi-location inventory | Multiple warehouses per business, transfers, per-warehouse stock detail |
| Reporting & export | 6 report types (Daily/Weekly/Monthly/Employees/Products/Stock Alerts), CSV **and** PDF export, date filtering |
| Role-based permissions | Three-role model enforced per-business, not just per-account |
| Audit trail | Real `AuditLog` for every administrative/destructive action |
| Order/sale capture | A genuine POS register flow (search, cart, discounts, three payment methods), not just a spreadsheet |
| Credit/receivables management | A full partial-payment ledger per customer — most small-business tools at this price point don't have this at all |
| Product variants / pack sizes | Alternate units (dozen/carton/pcs conversion) — a real strength, not commonly found in entry-level tools |

## What's on the checklist that does NOT apply — and why

Flagging these explicitly so a future session doesn't accidentally start building them just because they showed up in a pasted list:

- **Multi-channel integration (Shopify/Amazon/eBay/WooCommerce/BigCommerce sync)** — VAE Inventory has no online storefront. There is no second sales channel to keep in sync with. This entire category only becomes relevant if Victor's dad's businesses start selling online somewhere — worth asking about later, not building speculatively.
- **3PL management, carrier rate shopping, shipping label generation** — nothing is shipped to strangers; every sale is in-person, walk-out-with-the-goods. Not applicable.
- **Manufacturing (BOM, work orders, MRP, shop floor tracking)** — these businesses resell/retail; they don't manufacture. Not applicable.
- **EDI** — a large-enterprise B2B data-exchange standard. Wildly out of scope at this size.
- **"AI-powered insights" as a headline feature** — a marketing hook for Fishbowl specifically, not a foundational inventory-management capability. Worth revisiting once there's enough real transaction history to make suggestions meaningful, not now.
- **Accounting integration (QuickBooks/Xero)** — genuinely could be useful, but only if Victor's dad's businesses actually use one of those tools. Ask before building; don't assume.

## What's genuinely missing and worth adopting

This is the real gap — general inventory-management fundamentals that apply to *any* business holding stock, physical or online, which VAE Inventory doesn't have yet. Ordered by priority (see `phases/phase-g-*.md` onward for the detailed plan on each):

### 1. Cost price & profitability (Phase G) — the single biggest gap
`Product` today has a selling `price` but **no cost price at all**. That means the app cannot answer "what's our actual profit?" on anything — not per sale, not per product, not per period. Every "profitability analysis," "margin," and "carrying cost" metric on the checklist is downstream of this one missing field. This is the highest-leverage single addition available: cheap to build, and it unlocks real financial visibility the business doesn't have today.

### 2. Barcode scanning (Phase H) — the biggest day-to-day usability win
The register already has `Product.shortCode` (a short manual-search key) — a natural foundation for a real scanned barcode. A phone/tablet's camera can scan a barcode directly in the browser (no extra hardware purchase required). For a busy walk-in retail counter, this is the difference between "type to search" and "point and beep" — a meaningful speed win for the actual daily user (the cashier), not just a checklist item.

### 3. Returns & stock adjustments (Phase I)
There's currently no way to formally reverse a sale (customer returns an item, stock goes back, money is refunded) or to reconcile "what the system says we have" against "what's actually on the shelf" (a stock take / cycle count). Both are routine physical-retail operations that don't exist yet — currently the only correction mechanism is a raw stock-movement transfer, which isn't the same thing and doesn't create the right audit trail.

### 4. Purchasing & supplier management (Phase J)
No `Supplier` entity, no purchase-order workflow, no cost-per-vendor or lead-time tracking. Today a "restock" is just a quantity typed in with no paper trail of who it was bought from, at what cost, or how long it took to arrive. This is the checklist's "automated replenishment" and "vendor management" items, scoped down to what a small business actually needs (not full MRP).

### 5. Smart reorder suggestions (Phase K) — deliberately sequenced last
True demand forecasting (suggest a reorder point from actual sales velocity, not a manually-set number) is valuable but needs (a) enough real sales history to be meaningful and (b) cost data from Phase G to also suggest *how much* to reorder cost-effectively. Building this before Phases G/J would produce a feature with nothing real to base its suggestions on.

### 6. Offline-resilient POS (not yet phased — revisit later)
This project already designed around "a shop with unreliable Wi-Fi" (see `completed.md`, self-hosted fonts decision, 2026-07-24). A true offline-capable register (queue sales locally, sync when the connection returns) is a real, on-brand improvement — but it's a meaningfully large engineering investment (service worker, local queue, conflict resolution). Flagged as worth doing eventually, not scheduled yet — revisit after Phases G–K land and once the real production hosting decision (`decisions.md` ADR-13) is settled, since offline-resilience matters more once this is genuinely someone's daily-dependency tool.

## What this means for `todo.md`

Phase E (deployment/ops) remains open and unrelated to this analysis — it's still the only thing blocking a real production launch. These new phases (G onward) are the **next feature-development track**, not a replacement for finishing Phase E. See `todo.md` for how the two tracks relate.
