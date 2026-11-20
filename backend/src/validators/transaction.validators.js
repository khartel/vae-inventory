/**
 * Zod request-validation schemas for the transaction/sale endpoints
 * (creating sales, listing/filtering them, and recording credit payments).
 */
const { z } = require("zod");

/** Validates routes scoped to a business only. */
const businessIdParamSchema = {
  params: z.object({ businessId: z.string().uuid("Invalid business id") }),
};

/** Validates routes that target a specific transaction (e.g. recording a payment against it). */
const transactionIdParamSchema = {
  params: z.object({
    businessId: z.string().uuid("Invalid business id"),
    transactionId: z.string().uuid("Invalid transaction id"),
  }),
};

/**
 * Validates POST .../transactions - creates a sale with one or more line
 * items. `customerId` is conditionally required: the refine() enforces it
 * whenever paymentMethod is "CREDIT", since credit can only be extended to
 * a real, already-known customer (no typing an arbitrary name). `customerName`
 * stays free-text and optional - meaningful only for CASH/TRANSFER, where
 * it's just a receipt-display snapshot (see transaction.service.js).
 */
const createTransactionSchema = {
  params: businessIdParamSchema.params,
  body: z
    .object({
      paymentMethod: z.enum(["CASH", "TRANSFER", "CREDIT"], {
        message: "Payment method must be CASH, TRANSFER, or CREDIT",
      }),
      customerId: z.string().uuid("Invalid customer id").optional(),
      customerName: z.string().trim().optional(),
      notes: z.string().trim().optional(),
      // Only meaningful for CASH - the service ignores it for other payment
      // methods rather than rejecting it here, and checks it's enough to
      // cover the total there too (where the actual total is computed).
      amountTendered: z.coerce.number().nonnegative("Amount received can't be negative").optional(),
      items: z
        .array(
          z.object({
            productId: z.string().uuid("Invalid product id"),
            quantitySold: z.coerce.number().positive("Quantity must be greater than 0"),
            unitPrice: z.coerce.number().positive("Unit price must be greater than 0"),
            discountPercent: z.coerce.number().min(0).max(100).optional(),
            // Display-only: which pack size was actually rung up (e.g.
            // "dozen" x 2), when not the product's base unit.
            // quantitySold/unitPrice above must already be in base-unit terms.
            unitLabel: z.string().trim().optional(),
            unitQuantity: z.coerce.number().positive().optional(),
          })
        )
        .min(1, "At least one item is required"),
    })
    .refine(
      (data) => data.paymentMethod !== "CREDIT" || !!data.customerId,
      {
        message: "Select an existing customer for credit sales",
        path: ["customerId"],
      }
    ),
};

/** Validates GET .../transactions - filters by performer, payment method, paid status, date range, plus pagination. */
const listTransactionsQuerySchema = {
  params: businessIdParamSchema.params,
  query: z.object({
    performedById: z.string().uuid().optional(),
    paymentMethod: z.enum(["CASH", "TRANSFER", "CREDIT"]).optional(),
    paid: z.enum(["true", "false"]).optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(100).optional(),
  }),
};

/** Validates POST .../transactions/:transactionId/payments - records a payment amount against a credit sale. */
const recordPaymentSchema = {
  params: transactionIdParamSchema.params,
  body: z.object({
    amount: z.coerce.number().positive("Amount must be greater than 0"),
  }),
};

/** Validates DELETE .../transactions/:transactionId/payments/:paymentId - undoes a recorded credit payment. */
const undoPaymentSchema = {
  params: z.object({
    businessId: z.string().uuid("Invalid business id"),
    transactionId: z.string().uuid("Invalid transaction id"),
    paymentId: z.string().uuid("Invalid payment id"),
  }),
};

/**
 * Validates POST .../transactions/:transactionId/returns - reverses some or
 * all of a sale's items. `refundMethod` is CASH (money handed back) or
 * CREDIT_BALANCE (reduces what's owed on an outstanding CREDIT sale) - the
 * service enforces which is actually allowed for a given transaction, since
 * that depends on data (paymentMethod, balanceDue) the validator can't see.
 */
const createReturnSchema = {
  params: transactionIdParamSchema.params,
  body: z.object({
    items: z
      .array(
        z.object({
          transactionItemId: z.string().uuid("Invalid transaction item id"),
          quantityReturned: z.coerce.number().positive("Quantity must be greater than 0"),
        })
      )
      .min(1, "Select at least one item to return")
      .refine(
        (items) => new Set(items.map((item) => item.transactionItemId)).size === items.length,
        "Each item can only appear once in a return"
      ),
    refundMethod: z.enum(["CASH", "CREDIT_BALANCE"], {
      message: "Refund method must be CASH or CREDIT_BALANCE",
    }),
    reason: z.string().trim().optional(),
  }),
};

module.exports = {
  businessIdParamSchema,
  transactionIdParamSchema,
  createTransactionSchema,
  listTransactionsQuerySchema,
  recordPaymentSchema,
  undoPaymentSchema,
  createReturnSchema,
};
