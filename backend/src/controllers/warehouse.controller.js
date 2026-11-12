const {
  createWarehouse,
  getWarehouses,
  getWarehouseById,
  setPrimaryWarehouse,
  updateWarehouse,
  deleteWarehouse,
  getDeletedWarehouses,
  restoreWarehouse,
} = require("../services/warehouse.service");
const { sendSuccess } = require("../utils/response.utils");
const asyncHandler = require("../utils/asyncHandler");

/**
 * POST /api/businesses/:businessId/warehouses
 * Creates a new warehouse/storage location for the business. If `isPrimary`
 * is true it becomes the default location stock operations target.
 */
const create = asyncHandler(async (req, res) => {
  const { name, location, isPrimary } = req.body;
  const { businessId } = req.params;

  const warehouse = await createWarehouse({
    businessId,
    name,
    location,
    isPrimary: isPrimary || false,
    userId: req.user.id,
  });

  return sendSuccess(res, {
    message: "Warehouse created successfully",
    data: warehouse,
    statusCode: 201,
  });
});

/**
 * GET /api/businesses/:businessId/warehouses
 * Lists every warehouse belonging to the business.
 */
const getAll = asyncHandler(async (req, res) => {
  const warehouses = await getWarehouses(req.params.businessId);

  return sendSuccess(res, {
    message: "Warehouses fetched successfully",
    data: warehouses,
  });
});

/**
 * GET /api/businesses/:businessId/warehouses/:warehouseId
 * Fetches a single warehouse's details by id, scoped to the business.
 */
const getOne = asyncHandler(async (req, res) => {
  const warehouse = await getWarehouseById(
    req.params.warehouseId,
    req.params.businessId
  );

  return sendSuccess(res, {
    message: "Warehouse fetched successfully",
    data: warehouse,
  });
});

/**
 * PATCH /api/businesses/:businessId/warehouses/:warehouseId/primary
 * Marks this warehouse as the business's primary location, implicitly
 * unmarking whichever warehouse held that flag before (a business has at
 * most one primary warehouse at a time).
 */
const setPrimary = asyncHandler(async (req, res) => {
  const warehouse = await setPrimaryWarehouse(
    req.params.warehouseId,
    req.params.businessId
  );

  return sendSuccess(res, {
    message: "Primary warehouse updated successfully",
    data: warehouse,
  });
});

/**
 * PATCH /api/businesses/:businessId/warehouses/:warehouseId
 * Updates a warehouse's name and/or location. Returns the updated warehouse.
 */
const update = asyncHandler(async (req, res) => {
  const { name, location } = req.body;

  const warehouse = await updateWarehouse(
    req.params.warehouseId,
    req.params.businessId,
    { name, location }
  );

  return sendSuccess(res, {
    message: "Warehouse updated successfully",
    data: warehouse,
  });
});

/**
 * DELETE /api/businesses/:businessId/warehouses/:warehouseId
 * Deletes a warehouse from the business. Rejected if it's the primary
 * warehouse (must reassign primary first) or if it still holds stock.
 */
const remove = asyncHandler(async (req, res) => {
  const result = await deleteWarehouse(
    req.params.warehouseId,
    req.params.businessId,
    req.user.id
  );

  return sendSuccess(res, {
    message: result.message,
  });
});

/**
 * GET /api/businesses/:businessId/warehouses/deleted
 * Lists soft-deleted warehouses for the business (the "Trash" view).
 */
const getDeleted = asyncHandler(async (req, res) => {
  const warehouses = await getDeletedWarehouses(req.params.businessId);

  return sendSuccess(res, {
    message: "Deleted warehouses fetched successfully",
    data: warehouses,
  });
});

/**
 * POST /api/businesses/:businessId/warehouses/:warehouseId/restore
 * Restores a soft-deleted warehouse back into the active list.
 */
const restore = asyncHandler(async (req, res) => {
  const warehouse = await restoreWarehouse(
    req.params.warehouseId,
    req.params.businessId,
    req.user.id
  );

  return sendSuccess(res, {
    message: "Warehouse restored successfully",
    data: warehouse,
  });
});

module.exports = { create, getAll, getOne, setPrimary, update, remove, getDeleted, restore };
