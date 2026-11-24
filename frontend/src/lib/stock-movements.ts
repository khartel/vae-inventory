import type { QueryClient } from "@tanstack/react-query"
import type { StockMovement } from "@/services/stock.service"

export interface MovementBatch {
  key: string
  movement: StockMovement
  items: StockMovement[]
  productCount: number
}

export const ADJUSTMENT_REASON_LABELS: Record<NonNullable<StockMovement["adjustmentReason"]>, string> = {
  MISCOUNTED: "Miscounted",
  DAMAGED: "Damaged",
  THEFT: "Theft / shrinkage",
  OTHER: "Other",
}

/** Shared invalidation list for any stock-mutating action so caches stay in sync. */
export function invalidateStockQueries(queryClient: QueryClient, businessId: string | null | undefined) {
  if (!businessId) return
  for (const key of ["stock-movements", "products", "product", "warehouses", "warehouse", "stock", "report-stock-alerts"]) {
    queryClient.invalidateQueries({ queryKey: [key, businessId] })
  }
}

/** Human-readable origin label matching movement semantics (never "External" for returns/adjustments). */
export function getMovementOriginLabel(movement: StockMovement): string {
  if (movement.fromWarehouse?.name) return movement.fromWarehouse.name
  if (movement.type === "RETURN") return "Customer return"
  if (movement.type === "ADJUSTMENT") return "—"
  return "External"
}

/** Group by a saved operation reference, never by route or nearby timestamps. */
export function groupMovementBatches(movements: StockMovement[]): MovementBatch[] {
  const groups = new Map<string, MovementBatch>()
  for (const movement of [...movements].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))) {
    const reference = movement.batchId ?? (movement.type === "RETURN" ? movement.returnId : null)
    const key = JSON.stringify([
      reference ? "batch" : "line", reference ?? movement.id, movement.type,
      movement.fromWarehouse?.id ?? null, movement.toWarehouse.id, movement.movedBy.id, movement.status,
    ])
    const existing = groups.get(key)
    if (existing) existing.items.push(movement)
    else groups.set(key, { key, movement, items: [movement], productCount: 0 })
  }
  return [...groups.values()].map((group) => ({
    ...group,
    productCount: new Set(group.items.map((item) => item.product.id)).size,
    items: group.items.sort((a, b) => a.product.name.localeCompare(b.product.name)),
  }))
}

export function formatMovementQuantity(movement: StockMovement): string {
  if (movement.type === "ADJUSTMENT" && movement.previousQuantity != null && movement.newQuantity != null) {
    return `${movement.previousQuantity} → ${movement.newQuantity} ${movement.product.unit}`
  }
  return movement.unitQuantity != null && movement.unitLabel
    ? `${movement.unitQuantity} ${movement.unitLabel}`
    : `${movement.quantity} ${movement.product.unit}`
}
