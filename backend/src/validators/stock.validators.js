/**
 * Zod request-validation schemas for stock movements (transfers between
 * warehouses, restocking/receiving inventory, and the movement history feed).
 */
const { z } = require("zod");

/** Validates routes scoped to a business only. */
const businessIdParamSchema = {
  params: z.object({ businessId: z.string().uuid("Invalid business id") }),
};

/** Validates a stock transfer between two warehouses for a single product. */
const moveStockSchema = {
  params: businessIdParamSchema.params,
  body: z.object({
    fromWarehouseId: z.string().uuid("Invalid source warehouse id"),
    toWarehouseId: z.string().uuid("Invalid destination warehouse id"),
    productId: z.string().uuid("Invalid product id"),
    quantity: z.coerce.number().positive("Quantity must be greater than 0"),
    notes: z.string().trim().optional(),
  }),
};

/** Validates the stock-movement history query; all filters optional (date range, warehouses, product, movement type). */
const movementsQuerySchema = {
  params: businessIdParamSchema.params,
  query: z.object({
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    fromWarehouseId: z.string().uuid("Invalid source warehouse id").optional(),
    toWarehouseId: z.string().uuid("Invalid destination warehouse id").optional(),
    productId: z.string().uuid("Invalid product id").optional(),
    type: z.enum(["RESTOCK", "TRANSFER", "RETURN", "ADJUSTMENT"]).optional(),
  }),
};

/** Validates receiving new stock into a warehouse; requires at least one line item, each optionally setting a low-stock threshold. */
const receiveStockSchema = {
  params: businessIdParamSchema.params,
  body: z.object({
    warehouseId: z.string().uuid("Invalid warehouse id"),
    items: z
      .array(
        z.object({
          productId: z.string().uuid("Invalid product id"),
          quantity: z.coerce.number().positive("Quantity must be greater than 0"),
          lowStockThreshold: z.coerce.number().nonnegative().optional(),
          // Display-only: which pack size was actually entered (e.g.
          // "carton" x 3), when not the product's base unit. `quantity`
          // above must already be the converted base-unit amount.
          unitLabel: z.string().trim().optional(),
          unitQuantity: z.coerce.number().positive().optional(),
        })
      )
      .min(1, "Add at least one product"),
    notes: z.string().trim().optional(),
  }),
};

/**
 * Validates POST .../stock/adjust - reconciles a warehouse's system count
 * for one product to a physical count, with a required reason.
 */
const adjustStockSchema = {
  params: businessIdParamSchema.params,
  body: z.object({
    warehouseId: z.string().uuid("Invalid warehouse id"),
    productId: z.string().uuid("Invalid product id"),
    actualQuantity: z.coerce.number().nonnegative("Actual quantity can't be negative"),
    reason: z.enum(["DAMAGED", "MISCOUNTED", "THEFT", "OTHER"], {
      message: "Reason must be DAMAGED, MISCOUNTED, THEFT, or OTHER",
    }),
    notes: z.string().trim().optional(),
  }),
};

module.exports = {
  businessIdParamSchema,
  moveStockSchema,
  receiveStockSchema,
  movementsQuerySchema,
  adjustStockSchema,
};
