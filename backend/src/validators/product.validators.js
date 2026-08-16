/**
 * Zod request-validation schemas for the product endpoints (create/update
 * products within a business).
 */
const { z } = require("zod");

/** Validates routes scoped to a business only (e.g. GET/POST /businesses/:businessId/products). */
const businessIdParamSchema = {
  params: z.object({ businessId: z.string().uuid("Invalid business id") }),
};

/** Validates routes that also target a specific product (e.g. PATCH/DELETE .../products/:productId). */
const productIdParamSchema = {
  params: z.object({
    businessId: z.string().uuid("Invalid business id"),
    productId: z.string().uuid("Invalid product id"),
  }),
};

// Optional short code (e.g. barcode/SKU shorthand for fast POS lookup),
// capped at 20 chars; blank strings are coerced to undefined so an empty
// form field doesn't get persisted as "".
const shortCodeField = z
  .string()
  .trim()
  .max(20, "Short code must be 20 characters or fewer")
  .optional()
  .transform((value) => (value ? value : undefined));

// Optional alternate pack sizes (e.g. "dozen" = 12 base units). Price for
// each is always derived as product.price * factor - no separate price
// field to manage here.
const unitsField = z
  .array(
    z.object({
      label: z.string().trim().min(1, "Unit label is required"),
      factor: z.coerce.number().positive("Factor must be greater than 0"),
    })
  )
  .optional();

/** Validates POST /businesses/:businessId/products - creates a product; price defaults are handled downstream if omitted. */
const createProductSchema = {
  params: businessIdParamSchema.params,
  body: z.object({
    name: z.string().trim().min(1, "Product name is required"),
    unit: z.string().trim().min(1, "Unit is required"),
    price: z.coerce.number().nonnegative("Price cannot be negative").optional(),
    costPrice: z.coerce.number().nonnegative("Cost price cannot be negative").optional(),
    description: z.string().trim().optional(),
    shortCode: shortCodeField,
    units: unitsField,
  }),
};

/** Validates PATCH .../products/:productId - fields optional to support partial updates. */
const updateProductSchema = {
  params: productIdParamSchema.params,
  body: z.object({
    name: z.string().trim().min(1).optional(),
    unit: z.string().trim().min(1).optional(),
    price: z.coerce.number().nonnegative("Price cannot be negative").optional(),
    costPrice: z.coerce.number().nonnegative("Cost price cannot be negative").optional(),
    description: z.string().trim().optional(),
    shortCode: shortCodeField,
    units: unitsField,
  }),
};

module.exports = {
  businessIdParamSchema,
  productIdParamSchema,
  createProductSchema,
  updateProductSchema,
};
