# Phase I — Returns & Stock Adjustments

**Status: ⬜ Not started.** See `gap-analysis-2026-08.md`.

## Objective
Give the business two routine physical-retail operations it can't do today: (1) formally reverse a sale when a customer returns an item (stock goes back, money is refunded/credited), and (2) reconcile the system's stock count against a physical count (a stock take / cycle count), with a proper audit trail either way.

## Why it exists
Right now the only way to "correct" stock is a raw warehouse-to-warehouse transfer or a manual restock — neither of which is honest about *why* the number changed. A return isn't a transfer. A shrinkage/miscount adjustment isn't a restock. Both are common enough in daily retail that pretending they're something else erodes trust in the numbers over time.

## Dependencies
None structurally. Benefits from Phase G (cost price) existing first if returns should also reverse the recorded profit on that sale, not just the stock count — worth confirming with Victor when this phase is picked up.

## Deliverables
- **Sale returns**: a new flow off an existing `Transaction`/`TransactionItem` — mark some or all of a sale's items as returned, restock the returned quantity to the warehouse it was sold from, and record how the customer is made whole (cash refund, credit note, or reducing an outstanding credit balance if the original sale was CREDIT and unpaid). Full `AuditLog` entry, same discipline as every other administrative action in this codebase.
- **Stock adjustments (cycle count)**: a way to record "the shelf says X, the system says Y" and reconcile to X, with a required reason (damaged, miscounted, theft/shrinkage, other) — not a silent quantity edit. Distinct `StockMovement` type or a new lightweight model, whichever fits the existing schema more naturally when this is designed in detail.
- Both surfaces need role gating consistent with the rest of the app (returns/adjustments are the kind of action that probably shouldn't be EMPLOYEE-unrestricted, unlike routine sales).

## Risks
- Returns interacting with the credit-payment ledger (partial payments already made against a since-returned item) is the trickiest edge case — needs explicit design, not an afterthought.
- Scope creep risk: a "full RMA workflow" (multi-step approval, restocking fees, etc.) is enterprise-shaped and not warranted here — keep this to what an in-person small shop actually needs.

## Expected outcome
Stock numbers stay trustworthy over time because every change has an honest reason attached to it, and a customer return is a two-minute counter operation instead of an off-system workaround.
