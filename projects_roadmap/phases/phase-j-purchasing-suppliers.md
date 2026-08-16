# Phase J — Purchasing & Supplier Management

**Status: ⬜ Not started.** See `gap-analysis-2026-08.md`.

## Objective
Add a real supplier/vendor concept and a lightweight purchase-order workflow, so restocking has a paper trail: who it was bought from, at what cost, and how long it took to arrive.

## Why it exists
Today a "restock" is just a quantity typed into `ReceiveStockDialog` with no record of its source. This is the checklist's "vendor management" and "automated replenishment" items, deliberately scoped down to what a small business needs — not full enterprise procurement/MRP.

## Dependencies
Phase G (cost price) should land first — a purchase order's whole point is recording what was paid, which should flow into `Product.costPrice`/`TransactionItem`'s cost snapshot rather than being a second, disconnected cost concept.

## Deliverables
- New `Supplier` model (name, contact info — phone via the existing `PhoneInput` component, address) scoped per business, same shape as `Customer`.
- A lightweight `PurchaseOrder` concept: supplier + line items (product, quantity, unit cost) + status (draft/ordered/received). Receiving a PO (fully or partially) is what actually moves stock — this becomes the "real" version of today's ad hoc restock, with the plain manual restock flow kept available for cash-and-carry buys that don't warrant a formal PO.
- Lead-time tracking: date ordered vs. date received, surfaced per supplier over time (feeds Phase K's forecasting later).
- Cost price on receipt updates `Product.costPrice` (with a sane policy for what happens when the same product is bought from two suppliers at different prices — likely "most recent cost wins," matching how retail typically prices from replacement cost, but worth confirming when designed in detail).

## Risks
- Biggest scope-creep risk in the whole new-feature track — easy to accidentally build toward full procurement software. Keep it to "record what was ordered, from whom, at what cost, and mark it received" — nothing more (no approval chains, no budget controls, no multi-currency PO handling beyond what the business's own currency already covers).

## Expected outcome
Restocking has the same level of accountability sales already have — a real record of the transaction, not just a quantity that appeared.
