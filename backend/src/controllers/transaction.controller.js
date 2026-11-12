const {
  createTransaction,
  getTransactions,
  getTransactionById,
  getTransactionSummary,
  recordCreditPayment,
  undoCreditPayment,
  createReturn,
} = require("../services/transaction.service");
const { sendSuccess } = require("../utils/response.utils");
const asyncHandler = require("../utils/asyncHandler");

/**
 * POST /api/businesses/:businessId/transactions
 * Make a sale
 */
const create = asyncHandler(async (req, res) => {
  const { paymentMethod, items, notes, customerId, customerName, amountTendered } = req.body;

  const transaction = await createTransaction({
    businessId: req.params.businessId,
    performedById: req.user.id,
    paymentMethod,
    customerId,
    customerName,
    items,
    notes,
    amountTendered,
  });

  return sendSuccess(res, {
    message: "Sale recorded successfully",
    data: transaction,
    statusCode: 201,
  });
});

/**
 * GET /api/businesses/:businessId/transactions
 * Get all transactions with optional filters
 */
const getAll = asyncHandler(async (req, res) => {
  const {
    performedById,
    paymentMethod,
    paid,
    startDate,
    endDate,
    page,
    limit,
  } = req.validatedQuery;

  const result = await getTransactions({
    businessId: req.params.businessId,
    performedById,
    paymentMethod,
    paid,
    startDate,
    endDate,
    page: page || 1,
    limit: limit || 20,
  });

  return sendSuccess(res, {
    message: "Transactions fetched successfully",
    data: result,
  });
});

/**
 * GET /api/businesses/:businessId/transactions/summary
 * Get transaction summary for dashboard
 */
const getSummary = asyncHandler(async (req, res) => {
  const summary = await getTransactionSummary(req.params.businessId);

  return sendSuccess(res, {
    message: "Transaction summary fetched successfully",
    data: summary,
  });
});

/**
 * GET /api/businesses/:businessId/transactions/:transactionId
 * Get a single transaction
 */
const getOne = asyncHandler(async (req, res) => {
  const transaction = await getTransactionById(
    req.params.transactionId,
    req.params.businessId
  );

  return sendSuccess(res, {
    message: "Transaction fetched successfully",
    data: transaction,
  });
});

/**
 * POST /api/businesses/:businessId/transactions/:transactionId/payments
 * Record a full or partial payment against a credit sale
 */
const recordPayment = asyncHandler(async (req, res) => {
  const { amount } = req.body;

  const transaction = await recordCreditPayment(
    req.params.transactionId,
    req.params.businessId,
    { amount, recordedById: req.user.id }
  );

  return sendSuccess(res, {
    message: "Payment recorded",
    data: transaction,
    statusCode: 201,
  });
});

/**
 * DELETE /api/businesses/:businessId/transactions/:transactionId/payments/:paymentId
 * Undoes a previously-recorded credit payment (a correction, not a customer
 * refund) — deletes the payment and, if it had settled the sale, re-opens
 * the outstanding balance.
 */
const undoPayment = asyncHandler(async (req, res) => {
  const transaction = await undoCreditPayment(
    req.params.transactionId,
    req.params.paymentId,
    req.params.businessId,
    req.user.id
  );

  return sendSuccess(res, {
    message: "Payment undone",
    data: transaction,
  });
});

/**
 * POST /api/businesses/:businessId/transactions/:transactionId/returns
 * Reverses some or all of a sale's items — restocks the returned quantity
 * and either records a cash refund or reduces the outstanding credit balance.
 */
const createReturnController = asyncHandler(async (req, res) => {
  const { items, refundMethod, reason } = req.body;

  const transaction = await createReturn(req.params.transactionId, req.params.businessId, {
    items,
    refundMethod,
    reason,
    processedById: req.user.id,
  });

  return sendSuccess(res, {
    message: "Return recorded",
    data: transaction,
    statusCode: 201,
  });
});

module.exports = { create, getAll, getSummary, getOne, recordPayment, undoPayment, createReturnController };
