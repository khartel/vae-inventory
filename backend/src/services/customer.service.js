const prisma = require("../utils/prisma");
const AppError = require("../utils/AppError");
const { recordAudit } = require("../utils/auditLog");
const { computeCreditStats } = require("../utils/creditBalance");
const { withTransactionCostVisibility } = require("../utils/transactionResponse");

/**
 * Derives a customer's summary stats from their loaded transaction history:
 * total number of transactions, lifetime amount spent, and outstanding
 * credit — the sum of balances still owed on CREDIT sales that haven't
 * been marked fully paid (`paidAt` is null), accounting for both recorded
 * CreditPayments and CREDIT_BALANCE returns via `computeCreditStats`.
 * Strips the raw `transactions` array out of the returned object in favor
 * of these aggregates, since list views only need the summary, not every
 * line item.
 */
const withStats = (customer) => {
  const { transactions, ...rest } = customer;
  const totalSpent = transactions.reduce((sum, t) => sum + t.totalAmount, 0);
  const outstandingCredit =
    Math.round(
      transactions
        .filter((t) => t.paymentMethod === "CREDIT" && !t.paidAt)
        .reduce((sum, t) => sum + Math.max(0, computeCreditStats(t).balanceDue), 0) * 100
    ) / 100;

  return {
    ...rest,
    transactionCount: transactions.length,
    totalSpent,
    outstandingCredit,
  };
};

/**
 * Create a new customer record for a business. Returns it pre-shaped with
 * zeroed stats (transactionCount/totalSpent/outstandingCredit) so the
 * response matches the shape of `getCustomers`/`getCustomerById` without an
 * extra round-trip, since a brand-new customer has no transactions yet.
 *
 * @param {{businessId: string, name: string, phone: string, address: string}} params
 * @returns {Promise<object>} The created customer with zeroed stats.
 */
const createCustomer = async ({ businessId, name, phone, address }) => {
  const customer = await prisma.customer.create({
    data: { businessId, name, phone, address },
  });

  return { ...customer, transactionCount: 0, totalSpent: 0, outstandingCredit: 0 };
};

/**
 * List customers for a business, each annotated with aggregated spend/credit
 * stats (via `withStats`). Supports an optional case-insensitive name search
 * and a result limit, used to power the register's customer autocomplete as
 * well as the full Customers page.
 *
 * @param {string} businessId
 * @param {{search?: string, limit?: number}} [options]
 * @returns {Promise<object[]>} Customers sorted alphabetically by name.
 */
const getCustomers = async (businessId, { search, limit } = {}) => {
  const customers = await prisma.customer.findMany({
    where: {
      businessId,
      deletedAt: null,
      ...(search && { name: { contains: search, mode: "insensitive" } }),
    },
    include: {
      transactions: {
        select: {
          totalAmount: true,
          paymentMethod: true,
          paidAt: true,
          payments: { select: { amount: true } },
          returns: { select: { refundMethod: true, refundAmount: true } },
        },
      },
    },
    orderBy: { name: "asc" },
    ...(limit && { take: limit }),
  });

  return customers.map(withStats);
};

/**
 * Get a single customer with their full transaction history, each
 * transaction annotated with `amountPaid`/`balanceDue` so the UI can show
 * a running credit ledger per sale (not just the aggregate outstanding
 * total that `withStats` provides).
 *
 * @param {string} customerId
 * @param {string} businessId - Scopes the lookup to this business.
 * @param {{includeCostPrice?: boolean}} [options] - Manager-only response option for nested sale items.
 * @returns {Promise<object>} Customer with stats and a `transactions` array.
 * @throws {AppError} 404 if not found in this business.
 */
const getCustomerById = async (customerId, businessId, options = {}) => {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, businessId, deletedAt: null },
    include: {
      transactions: {
        orderBy: { createdAt: "desc" },
        include: {
          items: {
            include: {
              product: { select: { id: true, name: true, unit: true } },
            },
          },
          performedBy: { select: { id: true, fullName: true, username: true } },
          warehouse: { select: { id: true, name: true, isPrimary: true } },
          payments: { select: { amount: true } },
          returns: { select: { refundMethod: true, refundAmount: true } },
        },
      },
    },
  });

  if (!customer) {
    throw new AppError("Customer not found", 404);
  }

  const transactionsWithBalance = customer.transactions.map((t) => {
    const { amountPaid, balanceDue } = computeCreditStats(t);
    return withTransactionCostVisibility({ ...t, amountPaid, balanceDue }, options);
  });

  return { ...withStats(customer), transactions: transactionsWithBalance };
};

/**
 * Update a customer's name and/or phone. Only provided fields are changed;
 * name is required to be truthy to apply (falsy values are ignored, not
 * cleared), while phone can be explicitly cleared via `undefined` check.
 *
 * @param {string} customerId
 * @param {string} businessId - Scopes the lookup to this business.
 * @param {{name?: string, phone?: string, address?: string}} fields
 * @returns {Promise<object>} The updated customer.
 * @throws {AppError} 404 if not found in this business.
 */
const updateCustomer = async (customerId, businessId, { name, phone, address }) => {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, businessId, deletedAt: null },
  });

  if (!customer) {
    throw new AppError("Customer not found", 404);
  }

  const updated = await prisma.customer.update({
    where: { id: customerId },
    data: {
      ...(name && { name }),
      ...(phone !== undefined && { phone }),
      ...(address !== undefined && { address }),
    },
  });

  return updated;
};

/**
 * Soft-delete a customer: hides them from the directory/pickers by setting
 * `deletedAt`. Their past transactions are unaffected either way (each one
 * keeps a `customerName` snapshot). Records an audit entry in the same
 * transaction.
 */
const deleteCustomer = async (customerId, businessId, actorId) => {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, businessId, deletedAt: null },
  });

  if (!customer) {
    throw new AppError("Customer not found", 404);
  }

  const actor = await prisma.user.findUnique({ where: { id: actorId } });

  await prisma.$transaction(async (tx) => {
    await tx.customer.update({
      where: { id: customerId },
      data: { deletedAt: new Date() },
    });

    await recordAudit(tx, {
      businessId,
      actorId,
      actorName: actor?.fullName ?? null,
      action: "customer.deleted",
      entityType: "Customer",
      entityId: customerId,
      metadata: { name: customer.name },
    });
  });

  return { message: "Customer deleted successfully" };
};

/**
 * List soft-deleted customers for a business (the "Trash" view), newest
 * deletion first.
 *
 * @param {string} businessId
 * @returns {Promise<object[]>}
 */
const getDeletedCustomers = async (businessId) => {
  return prisma.customer.findMany({
    where: { businessId, deletedAt: { not: null } },
    orderBy: { deletedAt: "desc" },
  });
};

/**
 * Restore a soft-deleted customer by clearing `deletedAt`, bringing them
 * back into the directory/autocomplete.
 *
 * @param {string} customerId
 * @param {string} businessId - Scopes the lookup to this business.
 * @param {string} actorId
 * @returns {Promise<object>} The restored customer, with refreshed stats.
 * @throws {AppError} 404 if not found among this business's deleted customers.
 */
const restoreCustomer = async (customerId, businessId, actorId, options = {}) => {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, businessId, deletedAt: { not: null } },
  });

  if (!customer) {
    throw new AppError("Deleted customer not found", 404);
  }

  const actor = await prisma.user.findUnique({ where: { id: actorId } });

  await prisma.$transaction(async (tx) => {
    await tx.customer.update({
      where: { id: customerId },
      data: { deletedAt: null },
    });

    await recordAudit(tx, {
      businessId,
      actorId,
      actorName: actor?.fullName ?? null,
      action: "customer.restored",
      entityType: "Customer",
      entityId: customerId,
      metadata: { name: customer.name },
    });
  });

  return getCustomerById(customerId, businessId, options);
};

/**
 * Merge a duplicate customer record into another: every transaction
 * currently attributed to `duplicateId` is reassigned to `intoId`, then the
 * duplicate is soft-deleted (same treatment as a normal delete — it
 * disappears from the directory but its own row, and the transactions it
 * used to own, aren't destroyed). Fixes the "same person typed two
 * different ways" case (e.g. "Chidi" and "Chidi Okafor") without losing
 * either one's sales/credit history.
 *
 * `customerName` snapshots already stored on past transactions are left
 * untouched on purpose — they're a receipt-time record of what was typed
 * at the register, not a live pointer to the customer's current name.
 *
 * @param {string} duplicateId - The customer being merged away (soft-deleted).
 * @param {string} intoId - The surviving customer that inherits the transactions.
 * @param {string} businessId - Scopes both lookups to this business.
 * @param {string} actorId
 * @returns {Promise<object>} The surviving customer, with refreshed stats.
 * @throws {AppError} 404 if either customer isn't found; 400 if they're the same customer.
 */
const mergeCustomers = async (duplicateId, intoId, businessId, actorId, options = {}) => {
  if (duplicateId === intoId) {
    throw new AppError("Can't merge a customer into itself", 400);
  }

  const [duplicate, target] = await Promise.all([
    prisma.customer.findFirst({ where: { id: duplicateId, businessId, deletedAt: null } }),
    prisma.customer.findFirst({ where: { id: intoId, businessId, deletedAt: null } }),
  ]);

  if (!duplicate) {
    throw new AppError("Customer to merge was not found", 404);
  }
  if (!target) {
    throw new AppError("Target customer was not found", 404);
  }

  const actor = await prisma.user.findUnique({ where: { id: actorId } });

  await prisma.$transaction(async (tx) => {
    const { count: transactionsMoved } = await tx.transaction.updateMany({
      where: { customerId: duplicateId },
      data: { customerId: intoId },
    });

    await tx.customer.update({
      where: { id: duplicateId },
      data: { deletedAt: new Date() },
    });

    await recordAudit(tx, {
      businessId,
      actorId,
      actorName: actor?.fullName ?? null,
      action: "customer.merged",
      entityType: "Customer",
      entityId: duplicateId,
      metadata: { mergedName: duplicate.name, intoName: target.name, transactionsMoved },
    });
  });

  return getCustomerById(intoId, businessId, options);
};

module.exports = {
  createCustomer,
  getCustomers,
  getCustomerById,
  updateCustomer,
  deleteCustomer,
  getDeletedCustomers,
  restoreCustomer,
  mergeCustomers,
};
