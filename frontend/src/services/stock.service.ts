// Wrappers around the /businesses/:businessId/stock endpoints — inventory
// movements: restocking a warehouse from a supplier, or transferring stock
// between two of a business's own warehouses.
import { apiClient, apiRequest } from "@/lib/api-client"

// RESTOCK = new stock brought into a warehouse (no source warehouse).
// TRANSFER = stock moved from one of the business's warehouses to another.
// RETURN = stock restocked from a reversed sale (see transaction.service.ts's
// ReturnRecord) - shaped like a RESTOCK (no source warehouse).
// ADJUSTMENT = a cycle-count correction to a warehouse's system count -
// `toWarehouse` here means "the warehouse being corrected", not a literal
// transfer destination; see previousQuantity/newQuantity for direction.
export type MovementType = "RESTOCK" | "TRANSFER" | "RETURN" | "ADJUSTMENT"

// Only set on ADJUSTMENT movements - the reason a physical count didn't
// match the system count.
export type AdjustmentReason = "DAMAGED" | "MISCOUNTED" | "THEFT" | "OTHER"

// A single inventory movement record. `fromWarehouse` is null for RESTOCK/
// RETURN/ADJUSTMENT movements since stock isn't coming from another
// warehouse in the system. `unitLabel`/`unitQuantity` are display-only: set
// when the movement was entered in a pack size other than the product's
// base unit (e.g. "3 cartons") - `quantity` is always the base-unit amount
// actually applied (and, for ADJUSTMENT, always the positive magnitude of
// the change - see previousQuantity/newQuantity for direction).
export interface StockMovement {
  id: string
  /** Shared by product lines saved in one operation; absent on older records. */
  batchId?: string | null
  returnId?: string | null
  quantity: number
  unitLabel: string | null
  unitQuantity: number | null
  type: MovementType
  status: "PENDING" | "COMPLETED" | "CANCELLED"
  notes: string | null
  createdAt: string
  fromWarehouse: { id: string; name: string } | null
  toWarehouse: { id: string; name: string }
  product: { id: string; name: string; unit: string }
  movedBy: { id: string; fullName: string; username: string }
  // Only set on ADJUSTMENT movements.
  adjustmentReason: AdjustmentReason | null
  previousQuantity: number | null
  newQuantity: number | null
}

// Payload for transferring a quantity of one product between two warehouses.
export interface MoveStockInput {
  fromWarehouseId: string
  toWarehouseId: string
  productId: string
  quantity: number
  notes?: string
}

export interface MoveStockBatchInput {
  fromWarehouseId: string
  toWarehouseId: string
  items: Array<{ productId: string; quantity: number; unitLabel?: string; unitQuantity?: number }>
  notes?: string
}

// One product/quantity line within a restock batch. `lowStockThreshold`
// optionally (re)sets the alert threshold for that product in this warehouse.
export interface ReceiveStockItem {
  productId: string
  quantity: number
  lowStockThreshold?: number
  unitLabel?: string
  unitQuantity?: number
}

// Payload for receiving new stock (RESTOCK) into a single warehouse,
// potentially covering multiple products in one batch.
export interface ReceiveStockInput {
  warehouseId: string
  items: ReceiveStockItem[]
  notes?: string
}

// Optional filters for querying stock movement history.
export interface StockMovementFilters {
  startDate?: string
  endDate?: string
  fromWarehouseId?: string
  toWarehouseId?: string
  productId?: string
  type?: MovementType
}

// Payload for reconciling a warehouse's system count for one product to a
// physical (shelf) count.
export interface AdjustStockInput {
  warehouseId: string
  productId: string
  actualQuantity: number
  reason: AdjustmentReason
  notes?: string
}

/** Lists stock movements (restocks + transfers) for a business, optionally filtered. */
export const getStockMovements = (businessId: string, filters?: StockMovementFilters) =>
  apiRequest<StockMovement[]>(
    apiClient.get(`/businesses/${businessId}/stock/movements`, { params: filters })
  )

/** Transfers a quantity of one product from one warehouse to another. */
export const moveStock = (businessId: string, input: MoveStockInput) =>
  apiRequest<StockMovement>(apiClient.post(`/businesses/${businessId}/stock/move`, input))

/** All product lines move together, or the entire operation is rolled back. */
export const moveStockBatch = (businessId: string, input: MoveStockBatchInput) =>
  apiRequest<{ batchId: string; movements: StockMovement[] }>(
    apiClient.post(`/businesses/${businessId}/stock/move-bulk`, input)
  )

/** Receives (restocks) a batch of products into a single warehouse. */
export const receiveStock = (businessId: string, input: ReceiveStockInput) =>
  apiRequest<StockMovement[]>(apiClient.post(`/businesses/${businessId}/stock/receive`, input))

/** Reconciles a warehouse's system count for one product to a physical count. */
export const adjustStock = (businessId: string, input: AdjustStockInput) =>
  apiRequest<StockMovement>(apiClient.post(`/businesses/${businessId}/stock/adjust`, input))
