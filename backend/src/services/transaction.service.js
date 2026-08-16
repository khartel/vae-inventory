const prisma = require("../utils/prisma");
const AppError = require("../utils/AppError");
const { recordAudit } = require("../utils/auditLog");

// Shared include shape so every read path (create/list/get-one) returns the
// same structure, including the credit-payment history needed to compute
// amountPaid/balanceDue.
const TRANSACTION_INCLUDE = {
  items: {
    include: {
      product: {
        select: { id: true, name: true, unit: true },
      },
    },
  },
  performedBy: {
    select: { id: true, fullName: true, username: true, role: true },
  },
  warehouse: {
    select: { id: true, name: true, isPrimary: true },
  },
  payments: {
    include: {
      recordedBy: { select: { id: true, fullName: true, username: true } },
    },
    orderBy: { createdAt: "asc" },
  },
};

/**
 * Attach computed amountPaid/balanceDue (only meaningful for CREDIT sales,
 * but harmless — 0 paid / balanceDue === totalAmount — for others).
 */
const withCreditStats = (transaction) => {
  const amountPaid =
    Math.round(transaction.payments.reduce((sum, p) => sum + p.amount, 0) * 100) / 100;
  const balanceDue = Math.round((transaction.totalAmount - amountPaid) * 100) / 100;

  return { ...transaction, amountPaid, balanceDue };
};

/**
 * Create a new sale transaction. Sales are always fulfilled from the
 * business's single primary warehouse — the register doesn't let staff
 * pick a warehouse per sale. For each line item this validates the product
 * exists, stock is sufficient, and quantity/price are positive, computing
 * a subtotal and the overall total before touching the database.
 *
 * The actual write happens inside a `$transaction` that: (1) resolves who
 * the sale is attributed to — differently depending on payment method (see
 * `customerId`/`customerName` below); (2) creates the Transaction with its
 * nested TransactionItems; (3) decrements WarehouseStock for every item
 * sold. Wrapping all of this atomically guarantees a sale is never recorded
 * without its stock being deducted (or vice versa) even if something fails
 * partway through.
 *
 * Customer resolution differs by payment method:
 * - CREDIT: `customerId` must reference a real, non-deleted customer of this
 *   business (enforced here, not just by the validator, since the validator
 *   can't check the database) — credit can only ever be extended to someone
 *   already known, never an arbitrary typed name. The stored `customerName`
 *   snapshot is always derived from that customer's actual name, ignoring
 *   any client-supplied `customerName`, so a receipt can never diverge from
 *   who it's actually billed to.
 * - CASH/TRANSFER: `customerName` is free text. If it case-insensitively
 *   matches an existing customer, the sale links to them (so their
 *   purchase history/stats include it) — but no match no longer creates a
 *   new customer record (changed 2026-08-07; it used to auto-create). A
 *   blank name defaults to "Casual Customer" and is never linked.
 *
 * @param {object} params
 * @param {string} params.businessId
 * @param {string} params.performedById - Staff member making the sale.
 * @param {"CASH"|"TRANSFER"|"CREDIT"} params.paymentMethod
 * @param {string} [params.customerId] - Required for CREDIT; must be an existing customer of this business.
 * @param {string} [params.customerName] - Free-text name, CASH/TRANSFER only; blank defaults to "Casual Customer".
 * @param {Array<{productId: string, quantitySold: number, unitPrice: number, discountPercent?: number, unitLabel?: string, unitQuantity?: number}>} params.items
 *   `unitLabel`/`unitQuantity` are display-only passthroughs (e.g. "2
 *   dozen") - `quantitySold`/`unitPrice` must already be in base-unit terms.
 * @param {string} [params.notes]
 * @param {number} [params.amountTendered] - What the customer physically
 *   handed over; only meaningful (and only stored) for CASH sales. Ignored
 *   for TRANSFER/CREDIT. When given, `changeGiven` is derived from it.
 * @returns {Promise<object>} The created transaction with computed
 *   `amountPaid`/`balanceDue` (see `withCreditStats`).
 * @throws {AppError} If there's no primary warehouse, a product isn't
 *   found, stock is insufficient, quantity/price aren't positive, or (CASH
 *   only) amountTendered is less than the total.
 */
const createTransaction = async ({
  businessId,
  performedById,
  paymentMethod,
  customerId,
  customerName,
  items,
  notes,
  amountTendered,
}) => {
  // Get the primary warehouse for this business
  const primaryWarehouse = await prisma.warehouse.findFirst({
    where: {
      businessId,
      isPrimary: true,
      deletedAt: null,
    },
  });

  if (!primaryWarehouse) {
    throw new AppError(
      "No primary warehouse found. Please set a primary warehouse before making sales."
    );
  }

  // Validate all items (existence, quantity/price sanity) up front.
  const itemsWithDetails = await Promise.all(
    items.map(async (item) => {
      const product = await prisma.product.findFirst({
        where: {
          id: item.productId,
          businessId,
          deletedAt: null,
        },
      });

      if (!product) {
        throw new AppError(`Product not found: ${item.productId}`, 404);
      }

      if (item.quantitySold <= 0) {
        throw new AppError(`Quantity for "${product.name}" must be greater than 0`);
      }

      if (item.unitPrice <= 0) {
        throw new AppError(`Price for "${product.name}" must be greater than 0`);
      }

      return {
        productId: item.productId,
        productName: product.name,
        productUnit: product.unit,
        quantitySold: item.quantitySold,
        unitPrice: item.unitPrice,
        // Snapshotted so a later edit to the product's cost price never
        // rewrites this sale's historical profit - same reasoning as
        // productName/productUnit above. Null if the product has no cost
        // price recorded (see report.service.js's computeCostProfit, which
        // treats that as "unknown," never as a free/zero-cost item).
        costPrice: product.costPrice,
        subtotal: item.quantitySold * item.unitPrice,
        discountPercent: item.discountPercent ?? null,
        unitLabel: item.unitLabel ?? null,
        unitQuantity: item.unitQuantity ?? null,
      };
    })
  );

  // Check stock sufficiency per *product*, summing quantitySold across every
  // line item for that product first - a sale can list the same product
  // twice if it was rung up in two different pack sizes (e.g. "2 dozen" and
  // "3 pcs" of the same item, via ProductUnit), so checking each line in
  // isolation would under-count what's actually being taken out of stock.
  const totalRequestedByProduct = new Map();
  for (const item of itemsWithDetails) {
    totalRequestedByProduct.set(
      item.productId,
      (totalRequestedByProduct.get(item.productId) ?? 0) + item.quantitySold
    );
  }

  for (const [productId, totalRequested] of totalRequestedByProduct) {
    const stock = await prisma.warehouseStock.findUnique({
      where: {
        warehouseId_productId: { warehouseId: primaryWarehouse.id, productId },
      },
    });
    const { productName, productUnit } = itemsWithDetails.find((i) => i.productId === productId);

    if (!stock || stock.quantity < totalRequested) {
      throw new AppError(
        `Insufficient stock for "${productName}". ` +
        `Available: ${stock ? stock.quantity : 0} ${productUnit}, ` +
        `Requested: ${totalRequested} ${productUnit}`
      );
    }
  }

  const totalAmount = itemsWithDetails.reduce(
    (sum, item) => sum + item.subtotal,
    0
  );

  // Only CASH sales tender physical money that could warrant giving change;
  // silently ignore it for TRANSFER/CREDIT rather than rejecting it, same as
  // how customerName is silently optional outside CREDIT.
  let changeGiven = null;
  if (paymentMethod === "CASH" && amountTendered != null) {
    if (amountTendered < totalAmount - 0.01) {
      throw new AppError(
        `Amount received (${amountTendered}) is less than the total (${totalAmount})`
      );
    }
    changeGiven = Math.round((amountTendered - totalAmount) * 100) / 100;
  }
  const storedAmountTendered = paymentMethod === "CASH" ? (amountTendered ?? null) : null;

  const trimmedCustomerName = customerName?.trim();

  const transaction = await prisma.$transaction(async (tx) => {
    // Resolve who the sale is attributed to. CREDIT requires an existing,
    // real customer (never typed free-text, never auto-created) - see the
    // JSDoc above. CASH/TRANSFER link to an existing customer on an exact
    // (case-insensitive) name match, but no longer auto-create one on a miss.
    let resolvedCustomerId = null;
    let resolvedCustomerName = trimmedCustomerName || "Casual Customer";

    if (paymentMethod === "CREDIT") {
      const customer = await tx.customer.findFirst({
        where: { id: customerId, businessId, deletedAt: null },
      });
      if (!customer) {
        throw new AppError("Customer not found", 404);
      }
      resolvedCustomerId = customer.id;
      resolvedCustomerName = customer.name;
    } else if (trimmedCustomerName) {
      const existingCustomer = await tx.customer.findFirst({
        where: { businessId, deletedAt: null, name: { equals: trimmedCustomerName, mode: "insensitive" } },
      });
      resolvedCustomerId = existingCustomer?.id ?? null;
    }

    const newTransaction = await tx.transaction.create({
      data: {
        businessId,
        warehouseId: primaryWarehouse.id,
        performedById,
        customerId: resolvedCustomerId,
        paymentMethod,
        totalAmount,
        customerName: resolvedCustomerName,
        notes,
        amountTendered: storedAmountTendered,
        changeGiven,
        items: {
          create: itemsWithDetails.map((item) => ({
            productId: item.productId,
            quantitySold: item.quantitySold,
            unitPrice: item.unitPrice,
            costPrice: item.costPrice,
            subtotal: item.subtotal,
            discountPercent: item.discountPercent,
            unitLabel: item.unitLabel,
            unitQuantity: item.unitQuantity,
          })),
        },
      },
      include: TRANSACTION_INCLUDE,
    });

    // An atomic `decrement` (rather than computing `currentStock -
    // quantitySold` off a pre-transaction read) is required here: two items
    // in the same sale can reference the same product (sold in two
    // different pack sizes), so their updates must accumulate instead of
    // each overwriting the other with a stale snapshot.
    await Promise.all(
      itemsWithDetails.map((item) =>
        tx.warehouseStock.update({
          where: {
            warehouseId_productId: {
              warehouseId: primaryWarehouse.id,
              productId: item.productId,
            },
          },
          data: {
            quantity: { decrement: item.quantitySold },
          },
        })
      )
    );

    return newTransaction;
  });

  return withCreditStats(transaction);
};

/**
 * List transactions for a business, paginated, with optional filters by
 * employee, payment method, credit-settlement status, and date range. The
 * `paid` filter is only meaningful in combination with
 * `paymentMethod=CREDIT`: `"true"` returns settled credit sales
 * (`paidAt` set), `"false"` returns outstanding ones.
 *
 * @param {object} params
 * @param {string} params.businessId
 * @param {string} [params.performedById]
 * @param {string} [params.paymentMethod]
 * @param {"true"|"false"} [params.paid]
 * @param {string|Date} [params.startDate]
 * @param {string|Date} [params.endDate] - Treated as inclusive through end of that day.
 * @param {number} [params.page=1]
 * @param {number} [params.limit=20]
 * @returns {Promise<{transactions: object[], pagination: object}>}
 */
const getTransactions = async ({
  businessId,
  performedById,
  paymentMethod,
  paid,
  startDate,
  endDate,
  page = 1,
  limit = 20,
}) => {
  // Build filter
  const where = { businessId };

  // Filter by employee
  if (performedById) {
    where.performedById = performedById;
  }

  // Filter by payment method
  if (paymentMethod) {
    where.paymentMethod = paymentMethod;
  }

  // Filter by credit-settlement status (only meaningful alongside paymentMethod=CREDIT)
  if (paid === "true") {
    where.paidAt = { not: null };
  } else if (paid === "false") {
    where.paidAt = null;
  }

  // Filter by date range
  if (startDate || endDate) {
    where.createdAt = {};

    if (startDate) {
      where.createdAt.gte = new Date(startDate);
    }

    if (endDate) {
      // Set end date to end of that day
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      where.createdAt.lte = end;
    }
  }

  // Count total for pagination
  const total = await prisma.transaction.count({ where });

  // Fetch transactions
  const transactions = await prisma.transaction.findMany({
    where,
    include: TRANSACTION_INCLUDE,
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * limit,
    take: limit,
  });

  return {
    transactions: transactions.map(withCreditStats),
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
};

/**
 * Get a single transaction with its computed credit stats.
 *
 * @param {string} transactionId
 * @param {string} businessId - Scopes the lookup to this business.
 * @returns {Promise<object>}
 * @throws {AppError} 404 if not found in this business.
 */
const getTransactionById = async (transactionId, businessId) => {
  const transaction = await prisma.transaction.findFirst({
    where: {
      id: transactionId,
      businessId,
    },
    include: TRANSACTION_INCLUDE,
  });

  if (!transaction) {
    throw new AppError("Transaction not found", 404);
  }

  return withCreditStats(transaction);
};

/**
 * Record a payment against a CREDIT sale — either the full remaining
 * balance in one go, or a partial amount if the customer is paying it off
 * over time. Once cumulative payments cover the total (within a 1-cent
 * tolerance for float rounding), the sale is marked settled (`paidAt` set).
 * Creating the CreditPayment row and updating the transaction's `paidAt`
 * happen in one `$transaction` so a payment can never be recorded without
 * the settlement status being kept consistent with it.
 *
 * @param {string} transactionId - Must be a CREDIT-payment-method sale.
 * @param {string} businessId - Scopes the lookup to this business.
 * @param {{amount: number, recordedById: string}} payment - Amount must be
 *   > 0 and not exceed the outstanding balance (with a small tolerance).
 * @returns {Promise<object>} The updated transaction with refreshed credit stats.
 * @throws {AppError} 404 if not found; error if not a CREDIT sale, already
 *   fully paid, amount <= 0, or amount exceeds the outstanding balance.
 */
const recordCreditPayment = async (transactionId, businessId, { amount, recordedById }) => {
  const transaction = await prisma.transaction.findFirst({
    where: { id: transactionId, businessId },
    include: { payments: true },
  });

  if (!transaction) {
    throw new AppError("Transaction not found", 404);
  }

  if (transaction.paymentMethod !== "CREDIT") {
    throw new AppError("Only credit sales can have payments recorded against them");
  }

  const amountPaidSoFar = transaction.payments.reduce((sum, p) => sum + p.amount, 0);
  const balanceDue = Math.round((transaction.totalAmount - amountPaidSoFar) * 100) / 100;

  if (balanceDue <= 0) {
    throw new AppError("This sale has already been fully paid");
  }

  if (amount <= 0) {
    throw new AppError("Payment amount must be greater than 0");
  }

  if (amount > balanceDue + 0.01) {
    throw new AppError(`Payment can't exceed the outstanding balance of ${balanceDue}`);
  }

  const isNowSettled = amount >= balanceDue - 0.01;

  const updated = await prisma.$transaction(async (tx) => {
    await tx.creditPayment.create({
      data: { transactionId, amount, recordedById },
    });

    return tx.transaction.update({
      where: { id: transactionId },
      data: isNowSettled ? { paidAt: new Date() } : {},
      include: TRANSACTION_INCLUDE,
    });
  });

  return withCreditStats(updated);
};

/**
 * Undo a previously-recorded credit payment — deletes the CreditPayment row
 * outright (this is a "that was a mistake" correction, not a customer
 * refund with its own paper trail, so there's no separate voided/reversed
 * state to track) and, if the transaction had been marked settled because
 * of that payment, clears `paidAt` back to null since the balance is now
 * outstanding again. Both happen in one `$transaction` so the payment
 * record and the settlement flag can never drift apart.
 *
 * @param {string} transactionId
 * @param {string} paymentId - Must belong to transactionId.
 * @param {string} businessId - Scopes the lookup to this business.
 * @param {string} actorId - User undoing the payment (for the audit entry).
 * @returns {Promise<object>} The updated transaction with refreshed credit stats.
 * @throws {AppError} 404 if the transaction or payment isn't found.
 */
const undoCreditPayment = async (transactionId, paymentId, businessId, actorId) => {
  const transaction = await prisma.transaction.findFirst({
    where: { id: transactionId, businessId },
  });

  if (!transaction) {
    throw new AppError("Transaction not found", 404);
  }

  const payment = await prisma.creditPayment.findFirst({
    where: { id: paymentId, transactionId },
  });

  if (!payment) {
    throw new AppError("Payment not found", 404);
  }

  const actor = await prisma.user.findUnique({ where: { id: actorId } });

  const updated = await prisma.$transaction(async (tx) => {
    await tx.creditPayment.delete({ where: { id: paymentId } });

    const result = await tx.transaction.update({
      where: { id: transactionId },
      data: transaction.paidAt ? { paidAt: null } : {},
      include: TRANSACTION_INCLUDE,
    });

    await recordAudit(tx, {
      businessId,
      actorId,
      actorName: actor?.fullName ?? null,
      action: "credit_payment.undone",
      entityType: "Transaction",
      entityId: transactionId,
      metadata: { amount: payment.amount, customerName: transaction.customerName },
    });

    return result;
  });

  return withCreditStats(updated);
};

/**
 * Build the dashboard summary: today's transactions in full (with a
 * cash/transfer split and per-employee/per-product breakdowns computed in
 * memory), plus lightweight aggregate totals (via Prisma `aggregate`, not
 * full row fetches, since only sums/counts are needed) for the current
 * week and current month. Week starts Monday-based; both week and month
 * boundaries are computed relative to the server's local time.
 *
 * @param {string} businessId
 * @returns {Promise<object>} `{ today, byEmployee, topProducts, weekly, monthly }`.
 */
const getTransactionSummary = async (businessId) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);

  // Start of current week (Monday)
  const startOfWeek = new Date();
  startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay() + 1);
  startOfWeek.setHours(0, 0, 0, 0);

  // Start of current month
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  // Todays transactions
  const todayTransactions = await prisma.transaction.findMany({
    where: {
      businessId,
      createdAt: {
        gte: today,
        lte: endOfToday,
      },
    },
    include: {
      items: {
        include: {
          product: {
            select: {
              id: true,
              name: true,
              unit: true,
            },
          },
        },
      },
      performedBy: {
        select: {
          id: true,
          fullName: true,
          username: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // Weekly total
  const weeklyTotal = await prisma.transaction.aggregate({
    where: {
      businessId,
      createdAt: { gte: startOfWeek, lte: endOfToday },
    },
    _sum: { totalAmount: true },
    _count: true,
  });

  // Monthly total
  const monthlyTotal = await prisma.transaction.aggregate({
    where: {
      businessId,
      createdAt: { gte: startOfMonth, lte: endOfToday },
    },
    _sum: { totalAmount: true },
    _count: true,
  });

  // Today totals
  const todayTotal = todayTransactions.reduce(
    (sum, t) => sum + t.totalAmount,
    0
  );

  // Today totals by payment method
  const cashTotal = todayTransactions
    .filter((t) => t.paymentMethod === "CASH")
    .reduce((sum, t) => sum + t.totalAmount, 0);

  const transferTotal = todayTransactions
    .filter((t) => t.paymentMethod === "TRANSFER")
    .reduce((sum, t) => sum + t.totalAmount, 0);

  // Today sales by employee
  const employeeSales = {};
  todayTransactions.forEach((t) => {
    const key = t.performedById;
    if (!employeeSales[key]) {
      employeeSales[key] = {
        employee: t.performedBy,
        totalAmount: 0,
        transactionCount: 0,
        transactions: [],
      };
    }
    employeeSales[key].totalAmount += t.totalAmount;
    employeeSales[key].transactionCount += 1;
    employeeSales[key].transactions.push(t);
  });

  // Top selling products today
  const productSales = {};
  todayTransactions.forEach((t) => {
    t.items.forEach((item) => {
      const key = item.productId;
      if (!productSales[key]) {
        productSales[key] = {
          product: item.product,
          totalQuantity: 0,
          totalRevenue: 0,
        };
      }
      productSales[key].totalQuantity += item.quantitySold;
      productSales[key].totalRevenue += item.subtotal;
    });
  });

  return {
    today: {
      totalAmount: todayTotal,
      transactionCount: todayTransactions.length,
      cashTotal,
      transferTotal,
      transactions: todayTransactions,
    },
    byEmployee: Object.values(employeeSales),
    topProducts: Object.values(productSales).sort(
      (a, b) => b.totalRevenue - a.totalRevenue
    ),
    weekly: {
      totalAmount: weeklyTotal._sum.totalAmount || 0,
      transactionCount: weeklyTotal._count,
    },
    monthly: {
      totalAmount: monthlyTotal._sum.totalAmount || 0,
      transactionCount: monthlyTotal._count,
    },
  };
};

module.exports = {
  createTransaction,
  getTransactions,
  getTransactionById,
  getTransactionSummary,
  recordCreditPayment,
  undoCreditPayment,
};