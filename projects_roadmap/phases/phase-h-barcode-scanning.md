# Phase H — Barcode Scanning

**Status: ⬜ Not started.** See `gap-analysis-2026-08.md`.

## Objective
Let a cashier scan a product's barcode (via phone/tablet camera, no extra hardware) at the register and during restocking, instead of typing a search term every time.

## Why it exists
This is the single biggest day-to-day usability win available for the actual daily user — the cashier at a busy counter. `Product.shortCode` already exists as a manual short-search key; a real scanned barcode is a natural extension of the same idea, not a new concept.

## Dependencies
None structurally, but pairs naturally with `ProductSearch.tsx`/`ProductPicker.tsx` (register and restock flows already have a search-driven UX to plug scanning into).

## Deliverables
- `Product.barcode` field (distinct from `shortCode` — a barcode is typically a scanned, vendor-assigned numeric/EAN/UPC value; `shortCode` stays the human-typed shortcut. Both should resolve a product at the register).
- Camera-based scanning in the browser (the `BarcodeDetector` Web API where supported, with a lightweight JS-library fallback for browsers that don't implement it — e.g. Safari/iOS at time of writing) wired into `ProductSearch.tsx` (register) and `ReceiveStockDialog.tsx`/`ProductPicker.tsx` (restock).
- A way to assign/print a barcode isn't in scope for a first pass unless products are already barcoded (e.g. purchased goods with existing manufacturer barcodes) — scanning existing barcodes is the priority; generating/printing new ones for products that don't have one is a natural follow-up, not bundled in here.

## Risks
- Browser/device camera-permission UX varies; needs a graceful fallback to the existing type-to-search flow, never a hard requirement.
- `BarcodeDetector` isn't universally supported — confirm actual current browser support before committing to it alone vs. a JS-only scanning library.

## Expected outcome
Ringing up a sale or receiving stock becomes "point and beep" for anything with a real barcode, with typed search still available as the fallback for everything else (short codes, custom/unbarcoded goods).
