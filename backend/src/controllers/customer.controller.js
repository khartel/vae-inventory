const {
  createCustomer,
  getCustomers,
  getCustomerById,
  updateCustomer,
  deleteCustomer,
  getDeletedCustomers,
  restoreCustomer,
  mergeCustomers,
} = require("../services/customer.service");
const { sendSuccess } = require("../utils/response.utils");
const asyncHandler = require("../utils/asyncHandler");

/**
 * POST /api/businesses/:businessId/customers
 * Creates a customer record (name + phone + address) for the business, used
 * for attaching sales/credit to a known customer. Returns the created customer.
 */
const create = asyncHandler(async (req, res) => {
  const { name, phone, address } = req.body;

  const customer = await createCustomer({
    businessId: req.params.businessId,
    name,
    phone,
    address,
  });

  return sendSuccess(res, {
    message: "Customer created successfully",
    data: customer,
    statusCode: 201,
  });
});

/**
 * GET /api/businesses/:businessId/customers
 * Lists customers for the business, optionally filtered by a `search` query
 * string (name/phone) and capped by `limit` — used for register autocomplete
 * as well as a full customer directory view.
 */
const getAll = asyncHandler(async (req, res) => {
  const { search, limit } = req.validatedQuery;

  const customers = await getCustomers(req.params.businessId, { search, limit });

  return sendSuccess(res, {
    message: "Customers fetched successfully",
    data: customers,
  });
});

/**
 * GET /api/businesses/:businessId/customers/:customerId
 * Fetches a single customer's details by id, scoped to the business.
 */
const getOne = asyncHandler(async (req, res) => {
  const customer = await getCustomerById(req.params.customerId, req.params.businessId);

  return sendSuccess(res, {
    message: "Customer fetched successfully",
    data: customer,
  });
});

/**
 * PATCH /api/businesses/:businessId/customers/:customerId
 * Updates a customer's name, phone, and/or address. Returns the updated customer.
 */
const update = asyncHandler(async (req, res) => {
  const { name, phone, address } = req.body;

  const customer = await updateCustomer(req.params.customerId, req.params.businessId, {
    name,
    phone,
    address,
  });

  return sendSuccess(res, {
    message: "Customer updated successfully",
    data: customer,
  });
});

/**
 * DELETE /api/businesses/:businessId/customers/:customerId
 * Deletes a customer record from the business's directory.
 */
const remove = asyncHandler(async (req, res) => {
  const result = await deleteCustomer(req.params.customerId, req.params.businessId, req.user.id);

  return sendSuccess(res, {
    message: result.message,
  });
});

/**
 * GET /api/businesses/:businessId/customers/deleted
 * Lists soft-deleted customers for the business (the "Trash" view).
 */
const getDeleted = asyncHandler(async (req, res) => {
  const customers = await getDeletedCustomers(req.params.businessId);

  return sendSuccess(res, {
    message: "Deleted customers fetched successfully",
    data: customers,
  });
});

/**
 * POST /api/businesses/:businessId/customers/:customerId/restore
 * Restores a soft-deleted customer back into the directory.
 */
const restore = asyncHandler(async (req, res) => {
  const customer = await restoreCustomer(req.params.customerId, req.params.businessId, req.user.id);

  return sendSuccess(res, {
    message: "Customer restored successfully",
    data: customer,
  });
});

/**
 * POST /api/businesses/:businessId/customers/:customerId/merge
 * Merges the customer at :customerId (a duplicate) into another customer
 * (`intoCustomerId` in the body), moving all its transactions over and
 * soft-deleting the duplicate. Returns the surviving customer.
 */
const merge = asyncHandler(async (req, res) => {
  const customer = await mergeCustomers(
    req.params.customerId,
    req.body.intoCustomerId,
    req.params.businessId,
    req.user.id
  );

  return sendSuccess(res, {
    message: "Customers merged successfully",
    data: customer,
  });
});

module.exports = { create, getAll, getOne, update, remove, getDeleted, restore, merge };
