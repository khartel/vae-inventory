const {
  createProduct,
  getProducts,
  getProductById,
  updateProduct,
  deleteProduct,
  getDeletedProducts,
  restoreProduct,
  receiveStock,
  getAllStock,
  moveStock,
  getStockMovements,
} = require("../services/product.service");
const { sendSuccess } = require("../utils/response.utils");
const asyncHandler = require("../utils/asyncHandler");

/**
 * POST /api/businesses/:businessId/products
 * Creates a new product catalog entry (name, unit, price, etc.) for the
 * business. Does not create any stock — use the stock/receive endpoint for
 * that. Returns the created product.
 */
const create = asyncHandler(async (req, res) => {
  const { name, unit, price, costPrice, description, shortCode, units } = req.body;

  const product = await createProduct({
    businessId: req.params.businessId,
    name,
    unit,
    price,
    costPrice,
    description,
    shortCode,
    units,
  });

  return sendSuccess(res, {
    message: "Product created successfully",
    data: product,
    statusCode: 201,
  });
});

/**
 * GET /api/businesses/:businessId/products
 * Lists every product in the business's catalog.
 */
const getAll = asyncHandler(async (req, res) => {
  const includeCostPrice = ["SUPERADMIN", "ADMIN"].includes(req.businessRole);
  const products = await getProducts(req.params.businessId, { includeCostPrice });

  return sendSuccess(res, {
    message: "Products fetched successfully",
    data: products,
  });
});

/**
 * GET /api/businesses/:businessId/products/:productId
 * Fetches a single product's details by id, scoped to the business.
 */
const getOne = asyncHandler(async (req, res) => {
  const includeCostPrice = ["SUPERADMIN", "ADMIN"].includes(req.businessRole);
  const product = await getProductById(
    req.params.productId,
    req.params.businessId,
    { includeCostPrice }
  );

  return sendSuccess(res, {
    message: "Product fetched successfully",
    data: product,
  });
});

/**
 * PATCH /api/businesses/:businessId/products/:productId
 * Updates a product's catalog fields (name, unit, price, description,
 * shortCode). Returns the updated product.
 */
const update = asyncHandler(async (req, res) => {
  const { name, unit, price, costPrice, description, shortCode, units } = req.body;

  const product = await updateProduct(
    req.params.productId,
    req.params.businessId,
    { name, unit, price, costPrice, description, shortCode, units }
  );

  return sendSuccess(res, {
    message: "Product updated successfully",
    data: product,
  });
});

/**
 * DELETE /api/businesses/:businessId/products/:productId
 * Soft-deletes a product from the business's catalog - hidden everywhere,
 * but its stock/sales history is left completely intact.
 */
const remove = asyncHandler(async (req, res) => {
  const result = await deleteProduct(
    req.params.productId,
    req.params.businessId,
    req.user.id
  );

  return sendSuccess(res, {
    message: result.message,
  });
});

/**
 * GET /api/businesses/:businessId/products/deleted
 * Lists soft-deleted products for the business (the "Trash" view).
 */
const getDeleted = asyncHandler(async (req, res) => {
  const products = await getDeletedProducts(req.params.businessId);

  return sendSuccess(res, {
    message: "Deleted products fetched successfully",
    data: products,
  });
});

/**
 * POST /api/businesses/:businessId/products/:productId/restore
 * Restores a soft-deleted product back into the active catalog.
 */
const restore = asyncHandler(async (req, res) => {
  const product = await restoreProduct(req.params.productId, req.params.businessId, req.user.id);

  return sendSuccess(res, {
    message: "Product restored successfully",
    data: product,
  });
});

/**
 * POST /api/businesses/:businessId/stock/receive
 * Receive incoming stock (a restock/delivery) into one warehouse for one or more products
 */
const receiveStockController = asyncHandler(async (req, res) => {
  const { warehouseId, items, notes } = req.body;
  const { businessId } = req.params;

  const movements = await receiveStock({
    businessId,
    warehouseId,
    items,
    movedById: req.user.id,
    notes,
  });

  return sendSuccess(res, {
    message: "Stock received successfully",
    data: movements,
    statusCode: 201,
  });
});

/**
 * GET /api/businesses/:businessId/stock
 * Get all stock across all warehouses
 */
const getStock = asyncHandler(async (req, res) => {
  const stock = await getAllStock(req.params.businessId);

  return sendSuccess(res, {
    message: "Stock fetched successfully",
    data: stock,
  });
});

/**
 * POST /api/businesses/:businessId/stock/move
 * Move stock between warehouses
 */
const moveStockBetweenWarehouses = asyncHandler(async (req, res) => {
  const { fromWarehouseId, toWarehouseId, productId, quantity, notes } = req.body;
  const { businessId } = req.params;

  const movement = await moveStock({
    businessId,
    fromWarehouseId,
    toWarehouseId,
    productId,
    quantity,
    movedById: req.user.id,
    notes,
  });

  return sendSuccess(res, {
    message: "Stock moved successfully",
    data: movement,
    statusCode: 201,
  });
});

/**
 * GET /api/businesses/:businessId/stock/movements
 * Get stock movement history
 */
const getMovements = asyncHandler(async (req, res) => {
  const movements = await getStockMovements(req.params.businessId, req.validatedQuery);

  return sendSuccess(res, {
    message: "Stock movements fetched successfully",
    data: movements,
  });
});

module.exports = {
  create,
  getAll,
  getOne,
  update,
  remove,
  getDeleted,
  restore,
  receiveStockController,
  getStock,
  moveStockBetweenWarehouses,
  getMovements,
};
