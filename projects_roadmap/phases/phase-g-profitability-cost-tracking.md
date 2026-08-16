# Phase G — Profitability & Cost Tracking

**Status: ✅ Done (2026-08-16).** See `gap-analysis-2026-08.md` for the reasoning behind this being first in the new feature track, and `completed.md` for the full implementation write-up.

## Objective
Add a cost price to every product and use it to surface real profit — per sale, per product, per period — across the existing Reports screens. Turn "how much did we sell?" (already answered today) into "how much did we actually make?" (not answerable today).

## Why it exists
`Product` currently has a selling `price` but no cost price at all. Every "profitability," "margin," and "carrying cost" concept from standard inventory-management practice depends on this one missing field. It's the highest-leverage single addition available — cheap to build, and it unlocks financial visibility the business genuinely doesn't have right now.

## Dependencies
None. Pure additive schema + reporting work on the existing product/transaction model.

## Deliverables
- `Product.costPrice` (nullable at first — existing products won't have one set; reports should clearly distinguish "no cost data" from "zero profit" rather than silently showing ₦0 margin).
- Product form gains a cost-price field (SUPERADMIN/ADMIN only, same gating as price).
- `TransactionItem` snapshots the cost price at time of sale (same reasoning as `unitPrice` already being snapshotted — a later cost-price edit shouldn't rewrite historical profit numbers).
- Reports gain a profit/margin view: a margin column on the Products page, and a profit figure alongside revenue on Daily/Weekly/Monthly/Employees/Products reports (not Stock Alerts, which has no money in it). Deliberately **not** added to `TransactionDetailSheet` (the receipt view) — cost/margin stays in Reports only, since receipts are also opened by Employees.
- **Not built in this pass, intentionally deferred**: inventory turnover ratio and days-inventory-outstanding — these need real sales history to accumulate first now that cost data exists going forward; revisit once there's enough of it.

## Risks
- Existing products have no cost price — reports must handle this gracefully (e.g. "cost data incomplete for N products" rather than a misleadingly low/zero margin figure).
- Cost price is sensitive business data — needs the same care around who can see it as price already gets, likely tighter (a cashier/EMPLOYEE probably shouldn't see margin at the register, even though they can see selling price).

## Expected outcome
The owner can answer "what's actually making money?" for the first time — a foundational capability every other profitability-flavored feature on the gap-analysis checklist depends on.
