const prisma = require("../utils/prisma");
const { startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, format, eachDayOfInterval, eachWeekOfInterval } = require("date-fns");
const { getThresholdSettings, resolveLowStockThreshold } = require("../utils/lowStockThreshold");

/**
 * Builds a Prisma-friendly date range filter (`{ gte, lte }`) spanning the
 * full calendar days from `startDate` to `endDate` inclusive. Defaults each
 * end to "now" when not provided, so callers get a sensible single-day
 * range (today) if no dates are passed at all.
 *
 * @param {string|Date} [startDate]
 * @param {string|Date} [endDate]
 * @returns {{gte: Date, lte: Date}}
 */
const buildDateRange = (startDate, endDate) => {
  const start = startDate ? new Date(startDate) : new Date();
  const end = endDate ? new Date(endDate) : new Date();

  return {
    gte: startOfDay(start),
    lte: endOfDay(end),
  };
};

/**
 * Sums cost and profit for a flat array of TransactionItems. An item with no
 * `costPrice` snapshot (the product had no cost price recorded at sale time)
 * is excluded from *both* the revenue and cost sums here, not just the cost
 * sum - `totalProfit` must only ever be revenue-minus-cost over the exact
 * same subset of items, or it would silently count an uncosted item's full
 * revenue as pure profit (overstating it) the moment any sale in the set
 * lacks cost data. `hasIncompleteCostData` flags when that happened, so the
 * frontend can show a caveat instead of a misleadingly precise number - it
 * does NOT mean "some revenue is missing," only "some cost is unknown."
 *
 * @param {Array<{subtotal: number, costPrice: number|null, quantitySold: number}>} items
 * @returns {{totalCost: number, totalProfit: number, hasIncompleteCostData: boolean}}
 */
const computeCostProfit = (items) => {
  let costKnownRevenue = 0;
  let totalCost = 0;
  let hasIncompleteCostData = false;

  for (const item of items) {
    if (item.costPrice != null) {
      costKnownRevenue += item.subtotal;
      totalCost += item.costPrice * item.quantitySold;
    } else {
      hasIncompleteCostData = true;
    }
  }

  return {
    totalCost,
    totalProfit: costKnownRevenue - totalCost,
    hasIncompleteCostData,
  };
};

/**
 * Daily Report — full breakdown of a single day's sales: overall totals,
 * a cash-vs-transfer split, and per-employee and per-product breakdowns
 * (each built by grouping the day's transactions in memory with a map
 * keyed by employee/product ID, since a single day's volume is small
 * enough not to need per-group queries).
 *
 * @param {string} businessId
 * @param {string|Date} [date] - Defaults to today if omitted.
 * @returns {Promise<object>} `{ date, summary, transactions, byEmployee, byProduct }`.
 */
const getDailyReport = async (businessId, date) => {
  const targetDate = date ? new Date(date) : new Date();

  const dateRange = {
    gte: startOfDay(targetDate),
    lte: endOfDay(targetDate),
  };

  // Get all transactions for the day
  const transactions = await prisma.transaction.findMany({
    where: {
      businessId,
      createdAt: dateRange,
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
          role: true,
        },
      },
      warehouse: {
        select: {
          id: true,
          name: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // Total summary
  const totalAmount = transactions.reduce((sum, t) => sum + t.totalAmount, 0);
  const totalTransactions = transactions.length;

  // By payment method
  const cashTransactions = transactions.filter((t) => t.paymentMethod === "CASH");
  const transferTransactions = transactions.filter((t) => t.paymentMethod === "TRANSFER");

  const cashTotal = cashTransactions.reduce((sum, t) => sum + t.totalAmount, 0);
  const transferTotal = transferTransactions.reduce((sum, t) => sum + t.totalAmount, 0);

  // By employee
  const employeeMap = {};
  transactions.forEach((t) => {
    const key = t.performedById;
    if (!employeeMap[key]) {
      employeeMap[key] = {
        employee: t.performedBy,
        totalAmount: 0,
        transactionCount: 0,
        cashAmount: 0,
        transferAmount: 0,
        transactions: [],
      };
    }
    employeeMap[key].totalAmount += t.totalAmount;
    employeeMap[key].transactionCount += 1;
    employeeMap[key].transactions.push(t);

    if (t.paymentMethod === "CASH") {
      employeeMap[key].cashAmount += t.totalAmount;
    } else if (t.paymentMethod === "TRANSFER") {
      employeeMap[key].transferAmount += t.totalAmount;
    }
  });

  // By product
  const productMap = {};
  transactions.forEach((t) => {
    t.items.forEach((item) => {
      const key = item.productId;
      if (!productMap[key]) {
        productMap[key] = {
          product: item.product,
          totalQuantity: 0,
          totalRevenue: 0,
          totalCost: 0,
          totalProfit: 0,
          hasIncompleteCostData: false,
          timesSold: 0,
        };
      }
      productMap[key].totalQuantity += item.quantitySold;
      productMap[key].totalRevenue += item.subtotal;
      if (item.costPrice != null) {
        const cost = item.costPrice * item.quantitySold;
        productMap[key].totalCost += cost;
        productMap[key].totalProfit += item.subtotal - cost;
      } else {
        productMap[key].hasIncompleteCostData = true;
      }
      productMap[key].timesSold += 1;
    });
  });

  const allItems = transactions.flatMap((t) => t.items);
  const dayCostProfit = computeCostProfit(allItems);

  return {
    date: format(targetDate, "yyyy-MM-dd"),
    summary: {
      totalAmount,
      totalTransactions,
      cashTotal,
      cashTransactions: cashTransactions.length,
      transferTotal,
      transferTransactions: transferTransactions.length,
      ...dayCostProfit,
    },
    transactions,
    byEmployee: Object.values(employeeMap)
      .map((entry) => ({
        ...entry,
        ...computeCostProfit(entry.transactions.flatMap((t) => t.items)),
      }))
      .sort((a, b) => b.totalAmount - a.totalAmount),
    byProduct: Object.values(productMap).sort(
      (a, b) => b.totalRevenue - a.totalRevenue
    ),
  };
};

/**
 * Weekly Report — breaks a week's sales down by day (Monday-start weeks),
 * plus overall totals, the best-performing day, and per-employee/product
 * breakdowns for the whole week.
 *
 * @param {string} businessId
 * @param {string|Date} [date] - Any date within the target week; defaults to today.
 * @returns {Promise<object>} `{ weekStart, weekEnd, summary, dailyBreakdown, byEmployee, byProduct }`.
 */
const getWeeklyReport = async (businessId, date) => {
  const targetDate = date ? new Date(date) : new Date();
  const weekStart = startOfWeek(targetDate, { weekStartsOn: 1 }); // Monday
  const weekEnd = endOfWeek(targetDate, { weekStartsOn: 1 });     // Sunday

  // Get all transactions for the week
  const transactions = await prisma.transaction.findMany({
    where: {
      businessId,
      createdAt: {
        gte: weekStart,
        lte: weekEnd,
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
    orderBy: { createdAt: "asc" },
  });

  // Group by day
  const days = eachDayOfInterval({ start: weekStart, end: weekEnd });

  const dailyBreakdown = days.map((day) => {
    const dayTransactions = transactions.filter((t) => {
      const transDate = new Date(t.createdAt);
      return (
        transDate >= startOfDay(day) && transDate <= endOfDay(day)
      );
    });

    return {
      date: format(day, "yyyy-MM-dd"),
      dayName: format(day, "EEEE"),
      totalAmount: dayTransactions.reduce((sum, t) => sum + t.totalAmount, 0),
      transactionCount: dayTransactions.length,
      cashTotal: dayTransactions
        .filter((t) => t.paymentMethod === "CASH")
        .reduce((sum, t) => sum + t.totalAmount, 0),
      transferTotal: dayTransactions
        .filter((t) => t.paymentMethod === "TRANSFER")
        .reduce((sum, t) => sum + t.totalAmount, 0),
      ...computeCostProfit(dayTransactions.flatMap((t) => t.items)),
    };
  });

  // Overall week totals
  const totalAmount = transactions.reduce((sum, t) => sum + t.totalAmount, 0);
  const totalTransactions = transactions.length;

  // Best day of the week
  const bestDay = dailyBreakdown.reduce(
    (best, day) => (day.totalAmount > best.totalAmount ? day : best),
    dailyBreakdown[0]
  );

  // By employee for the week
  const employeeMap = {};
  transactions.forEach((t) => {
    const key = t.performedById;
    if (!employeeMap[key]) {
      employeeMap[key] = {
        employee: t.performedBy,
        totalAmount: 0,
        transactionCount: 0,
        items: [],
      };
    }
    employeeMap[key].totalAmount += t.totalAmount;
    employeeMap[key].transactionCount += 1;
    employeeMap[key].items.push(...t.items);
  });

  // By product for the week
  const productMap = {};
  transactions.forEach((t) => {
    t.items.forEach((item) => {
      const key = item.productId;
      if (!productMap[key]) {
        productMap[key] = {
          product: item.product,
          totalQuantity: 0,
          totalRevenue: 0,
          totalCost: 0,
          totalProfit: 0,
          hasIncompleteCostData: false,
        };
      }
      productMap[key].totalQuantity += item.quantitySold;
      productMap[key].totalRevenue += item.subtotal;
      if (item.costPrice != null) {
        const cost = item.costPrice * item.quantitySold;
        productMap[key].totalCost += cost;
        productMap[key].totalProfit += item.subtotal - cost;
      } else {
        productMap[key].hasIncompleteCostData = true;
      }
    });
  });

  return {
    weekStart: format(weekStart, "yyyy-MM-dd"),
    weekEnd: format(weekEnd, "yyyy-MM-dd"),
    summary: {
      totalAmount,
      totalTransactions,
      cashTotal: transactions
        .filter((t) => t.paymentMethod === "CASH")
        .reduce((sum, t) => sum + t.totalAmount, 0),
      transferTotal: transactions
        .filter((t) => t.paymentMethod === "TRANSFER")
        .reduce((sum, t) => sum + t.totalAmount, 0),
      bestDay,
      ...computeCostProfit(transactions.flatMap((t) => t.items)),
    },
    dailyBreakdown,
    byEmployee: Object.values(employeeMap)
      .map(({ items, ...entry }) => ({ ...entry, ...computeCostProfit(items) }))
      .sort((a, b) => b.totalAmount - a.totalAmount),
    byProduct: Object.values(productMap).sort(
      (a, b) => b.totalRevenue - a.totalRevenue
    ),
  };
};

/**
 * Monthly Report — breaks a month's sales down by day, plus overall
 * totals, average daily sales, the best day, and per-employee/product
 * breakdowns for the whole month.
 *
 * @param {string} businessId
 * @param {number} [year] - Defaults to the current year.
 * @param {number} [month] - 1-indexed month (1 = January); defaults to current month.
 * @returns {Promise<object>} `{ month, monthStart, monthEnd, summary, dailyBreakdown, byEmployee, byProduct }`.
 */
const getMonthlyReport = async (businessId, year, month) => {
  const targetDate = new Date(
    year || new Date().getFullYear(),
    (month || new Date().getMonth() + 1) - 1,
    1
  );

  const monthStart = startOfMonth(targetDate);
  const monthEnd = endOfMonth(targetDate);

  // Get all transactions for the month
  const transactions = await prisma.transaction.findMany({
    where: {
      businessId,
      createdAt: {
        gte: monthStart,
        lte: monthEnd,
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
    orderBy: { createdAt: "asc" },
  });

  // Group by day for the whole month
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });

  const dailyBreakdown = days.map((day) => {
    const dayTransactions = transactions.filter((t) => {
      const transDate = new Date(t.createdAt);
      return (
        transDate >= startOfDay(day) && transDate <= endOfDay(day)
      );
    });

    return {
      date: format(day, "yyyy-MM-dd"),
      dayName: format(day, "EEE"),
      totalAmount: dayTransactions.reduce((sum, t) => sum + t.totalAmount, 0),
      transactionCount: dayTransactions.length,
      ...computeCostProfit(dayTransactions.flatMap((t) => t.items)),
    };
  });

  // Overall month totals
  const totalAmount = transactions.reduce((sum, t) => sum + t.totalAmount, 0);
  const totalTransactions = transactions.length;

  // Average daily sales
  const avgDailySales = totalAmount / days.length;

  // Best day of the month
  const bestDay = dailyBreakdown.reduce(
    (best, day) => (day.totalAmount > best.totalAmount ? day : best),
    dailyBreakdown[0]
  );

  // By employee for the month
  const employeeMap = {};
  transactions.forEach((t) => {
    const key = t.performedById;
    if (!employeeMap[key]) {
      employeeMap[key] = {
        employee: t.performedBy,
        totalAmount: 0,
        transactionCount: 0,
        cashAmount: 0,
        transferAmount: 0,
        items: [],
      };
    }
    employeeMap[key].totalAmount += t.totalAmount;
    employeeMap[key].transactionCount += 1;
    employeeMap[key].items.push(...t.items);

    if (t.paymentMethod === "CASH") {
      employeeMap[key].cashAmount += t.totalAmount;
    } else if (t.paymentMethod === "TRANSFER") {
      employeeMap[key].transferAmount += t.totalAmount;
    }
  });

  // By product for the month
  const productMap = {};
  transactions.forEach((t) => {
    t.items.forEach((item) => {
      const key = item.productId;
      if (!productMap[key]) {
        productMap[key] = {
          product: item.product,
          totalQuantity: 0,
          totalRevenue: 0,
          totalCost: 0,
          totalProfit: 0,
          hasIncompleteCostData: false,
          timesSold: 0,
        };
      }
      productMap[key].totalQuantity += item.quantitySold;
      productMap[key].totalRevenue += item.subtotal;
      if (item.costPrice != null) {
        const cost = item.costPrice * item.quantitySold;
        productMap[key].totalCost += cost;
        productMap[key].totalProfit += item.subtotal - cost;
      } else {
        productMap[key].hasIncompleteCostData = true;
      }
      productMap[key].timesSold += 1;
    });
  });

  return {
    month: format(targetDate, "MMMM yyyy"),
    monthStart: format(monthStart, "yyyy-MM-dd"),
    monthEnd: format(monthEnd, "yyyy-MM-dd"),
    summary: {
      totalAmount,
      totalTransactions,
      avgDailySales,
      cashTotal: transactions
        .filter((t) => t.paymentMethod === "CASH")
        .reduce((sum, t) => sum + t.totalAmount, 0),
      transferTotal: transactions
        .filter((t) => t.paymentMethod === "TRANSFER")
        .reduce((sum, t) => sum + t.totalAmount, 0),
      bestDay,
      ...computeCostProfit(transactions.flatMap((t) => t.items)),
    },
    dailyBreakdown,
    byEmployee: Object.values(employeeMap)
      .map(({ items, ...entry }) => ({ ...entry, ...computeCostProfit(items) }))
      .sort((a, b) => b.totalAmount - a.totalAmount),
    byProduct: Object.values(productMap).sort(
      (a, b) => b.totalRevenue - a.totalRevenue
    ),
  };
};

/**
 * Employee Report — sales performance per team member over a date range:
 * total revenue, cash/transfer split, transaction count, and top products
 * sold by each. Fetches all team members and all in-range transactions in
 * one pair of parallel queries and groups them in memory, rather than
 * running a separate query per employee — this keeps the report to a fixed
 * number of DB round-trips regardless of team size.
 *
 * @param {string} businessId
 * @param {string|Date} [startDate]
 * @param {string|Date} [endDate]
 * @returns {Promise<object>} `{ startDate, endDate, employees }`, employees
 *   sorted by total revenue descending.
 */
const getEmployeeReport = async (businessId, startDate, endDate) => {
  const dateRange = buildDateRange(startDate, endDate);

  // Single pass: fetch team members and all in-range transactions once,
  // then group in memory instead of firing one query per employee.
  const [teamMembers, transactions] = await Promise.all([
    prisma.businessUser.findMany({
      where: { businessId },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            username: true,
            role: true,
          },
        },
      },
    }),
    prisma.transaction.findMany({
      where: {
        businessId,
        createdAt: dateRange,
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
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const transactionsByEmployee = {};
  transactions.forEach((t) => {
    if (!transactionsByEmployee[t.performedById]) {
      transactionsByEmployee[t.performedById] = [];
    }
    transactionsByEmployee[t.performedById].push(t);
  });

  const employeeReports = teamMembers.map((member) => {
    const memberTransactions = transactionsByEmployee[member.userId] || [];

    const totalAmount = memberTransactions.reduce((sum, t) => sum + t.totalAmount, 0);
    const cashTotal = memberTransactions
      .filter((t) => t.paymentMethod === "CASH")
      .reduce((sum, t) => sum + t.totalAmount, 0);
    const transferTotal = memberTransactions
      .filter((t) => t.paymentMethod === "TRANSFER")
      .reduce((sum, t) => sum + t.totalAmount, 0);

    // Products sold by this employee
    const productMap = {};
    memberTransactions.forEach((t) => {
      t.items.forEach((item) => {
        const key = item.productId;
        if (!productMap[key]) {
          productMap[key] = {
            product: item.product,
            totalQuantity: 0,
            totalRevenue: 0,
            totalCost: 0,
            totalProfit: 0,
            hasIncompleteCostData: false,
          };
        }
        productMap[key].totalQuantity += item.quantitySold;
        productMap[key].totalRevenue += item.subtotal;
        if (item.costPrice != null) {
          const cost = item.costPrice * item.quantitySold;
          productMap[key].totalCost += cost;
          productMap[key].totalProfit += item.subtotal - cost;
        } else {
          productMap[key].hasIncompleteCostData = true;
        }
      });
    });

    return {
      employee: member.user,
      businessRole: member.role,
      summary: {
        totalAmount,
        transactionCount: memberTransactions.length,
        cashTotal,
        transferTotal,
        ...computeCostProfit(memberTransactions.flatMap((t) => t.items)),
      },
      topProducts: Object.values(productMap).sort(
        (a, b) => b.totalRevenue - a.totalRevenue
      ),
      transactions: memberTransactions,
    };
  });

  return {
    startDate: format(new Date(dateRange.gte), "yyyy-MM-dd"),
    endDate: format(new Date(dateRange.lte), "yyyy-MM-dd"),
    employees: employeeReports.sort(
      (a, b) => b.summary.totalAmount - a.summary.totalAmount
    ),
  };
};

/**
 * Product Report — ranks products by revenue and by quantity sold over a
 * date range, with each product's average unit price (averaged across all
 * its sale line items, since price can vary per sale) and current stock
 * levels. Current stock for every product involved is fetched in a single
 * batched query (`productId: { in: [...] }`) rather than one query per
 * product, to keep this report cheap even with many distinct products sold.
 *
 * @param {string} businessId
 * @param {string|Date} [startDate]
 * @param {string|Date} [endDate]
 * @returns {Promise<object>} `{ startDate, endDate, totalProducts, bestSelling, mostQuantitySold }`.
 */
const getProductReport = async (businessId, startDate, endDate) => {
  const dateRange = buildDateRange(startDate, endDate);

  const transactionItems = await prisma.transactionItem.findMany({
    where: {
      transaction: {
        businessId,
        createdAt: dateRange,
      },
    },
    include: {
      product: {
        select: {
          id: true,
          name: true,
          unit: true,
          description: true,
        },
      },
      transaction: {
        select: {
          createdAt: true,
          paymentMethod: true,
        },
      },
    },
  });

  // Group by product
  const productMap = {};
  transactionItems.forEach((item) => {
    const key = item.productId;
    if (!productMap[key]) {
      productMap[key] = {
        product: item.product,
        totalQuantity: 0,
        totalRevenue: 0,
        totalCost: 0,
        totalProfit: 0,
        hasIncompleteCostData: false,
        timesSold: 0,
        avgUnitPrice: 0,
        prices: [],
      };
    }
    productMap[key].totalQuantity += item.quantitySold;
    productMap[key].totalRevenue += item.subtotal;
    if (item.costPrice != null) {
      const cost = item.costPrice * item.quantitySold;
      productMap[key].totalCost += cost;
      productMap[key].totalProfit += item.subtotal - cost;
    } else {
      productMap[key].hasIncompleteCostData = true;
    }
    productMap[key].timesSold += 1;
    productMap[key].prices.push(item.unitPrice);
  });

  // Calculate average price for each product
  const products = Object.values(productMap).map((p) => ({
    ...p,
    avgUnitPrice:
      p.prices.reduce((sum, price) => sum + price, 0) / p.prices.length,
    prices: undefined, // Remove prices array from response
  }));

  // Get current stock for all products in a single query instead of one per product
  const productIds = products.map((p) => p.product.id);
  const allStock = await prisma.warehouseStock.findMany({
    where: { productId: { in: productIds } },
    include: {
      warehouse: {
        select: {
          id: true,
          name: true,
          isPrimary: true,
        },
      },
    },
  });

  const stockByProduct = {};
  allStock.forEach((s) => {
    if (!stockByProduct[s.productId]) {
      stockByProduct[s.productId] = [];
    }
    stockByProduct[s.productId].push(s);
  });

  const productsWithStock = products.map((p) => {
    const stock = stockByProduct[p.product.id] || [];
    const totalStock = stock.reduce((sum, s) => sum + s.quantity, 0);

    return {
      ...p,
      currentStock: {
        total: totalStock,
        byWarehouse: stock,
      },
    };
  });

  return {
    startDate: format(new Date(dateRange.gte), "yyyy-MM-dd"),
    endDate: format(new Date(dateRange.lte), "yyyy-MM-dd"),
    totalProducts: productsWithStock.length,
    bestSelling: productsWithStock.sort(
      (a, b) => b.totalRevenue - a.totalRevenue
    ),
    mostQuantitySold: [...productsWithStock].sort(
      (a, b) => b.totalQuantity - a.totalQuantity
    ),
  };
};

/**
 * Stock Alert Report — buckets every stock line across all of a business's
 * warehouses into out-of-stock (quantity 0), low-stock (quantity > 0 but at
 * or below that line's effective threshold), and healthy, so reordering
 * decisions can be made at a glance. Each line's threshold is its own
 * explicit override if it has one, otherwise the business's configured
 * per-unit/default low-stock rule (Settings > Stock alerts) - see
 * `resolveLowStockThreshold`.
 *
 * @param {string} businessId
 * @returns {Promise<object>} `{ summary, outOfStock, lowStock, healthyStock }`.
 */
const getStockAlertReport = async (businessId) => {
  const [rawStock, thresholdSettings] = await Promise.all([
    prisma.warehouseStock.findMany({
      where: {
        warehouse: { businessId },
      },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            unit: true,
          },
        },
        warehouse: {
          select: {
            id: true,
            name: true,
            isPrimary: true,
          },
        },
      },
      orderBy: { quantity: "asc" },
    }),
    getThresholdSettings(businessId),
  ]);

  const stock = rawStock.map((s) => ({
    ...s,
    lowStockThreshold: resolveLowStockThreshold(s.lowStockThreshold, s.product.unit, thresholdSettings),
  }));

  const outOfStock = stock.filter((s) => s.quantity === 0);
  const lowStock = stock.filter(
    (s) => s.quantity > 0 && s.quantity <= s.lowStockThreshold
  );
  const healthyStock = stock.filter(
    (s) => s.quantity > s.lowStockThreshold
  );

  return {
    summary: {
      totalItems: stock.length,
      outOfStockCount: outOfStock.length,
      lowStockCount: lowStock.length,
      healthyCount: healthyStock.length,
    },
    outOfStock,
    lowStock,
    healthyStock,
  };
};

module.exports = {
  getDailyReport,
  getWeeklyReport,
  getMonthlyReport,
  getEmployeeReport,
  getProductReport,
  getStockAlertReport,
};