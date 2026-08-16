const prisma = require("../utils/prisma");
const AppError = require("../utils/AppError");
const { recordAudit } = require("../utils/auditLog");
const { startOfDay, endOfDay } = require("date-fns");
const { getThresholdSettings, resolveLowStockThreshold } = require("../utils/lowStockThreshold");

/**
 * Ensure a short code isn't already used by another product in this
 * business. Short codes are used for fast barcode/keyboard lookups at the
 * register, so they must be unique per business (case-insensitively).
 * No-ops if `shortCode` is falsy, since it's an optional field.
 *
 * @param {string} businessId
 * @param {string} shortCode
 * @param {string} [excludeProductId] - When updating a product, excludes it
 *   from the uniqueness check so a product keeping its own code doesn't
 *   collide with itself.
 * @throws {AppError} 409 if another product already uses this short code.
 */
const assertShortCodeAvailable = async (businessId, shortCode, excludeProductId) => {
  if (!shortCode) return;

  const existing = await prisma.product.findFirst({
    where: {
      businessId,
      shortCode: { equals: shortCode, mode: "insensitive" },
      ...(excludeProductId && { NOT: { id: excludeProductId } }),
    },
  });

  if (existing) {
    throw new AppError(`Short code "${shortCode}" is already used by another product`, 409);
  }
};

/**
 * Ensures a product's alternate pack sizes (`units`, e.g. "dozen" = 12)
 * don't collide with each other or with its own base `unit` - both checked
 * case-insensitively, since "Dozen" and "dozen" would otherwise both be
 * offered as if they were different choices at the register.
 *
 * @param {string} baseUnit - The product's base `unit` field.
 * @param {Array<{label: string, factor: number}>} [units]
 * @throws {AppError} 400 if any label collides with the base unit or with
 *   another label in the array.
 */
const assertUnitsValid = (baseUnit, units) => {
  if (!units || units.length === 0) return;

  const seen = new Set([baseUnit.trim().toLowerCase()]);
  for (const { label } of units) {
    const key = label.trim().toLowerCase();
    if (seen.has(key)) {
      throw new AppError(
        `Alternate unit "${label}" must be different from the product's base unit and from other alternate units`,
        400
      );
    }
    seen.add(key);
  }
};

/**
 * Create a new product for a business. Enforces a case-insensitive unique
 * product name per business (in addition to the short-code uniqueness check
 * delegated to `assertShortCodeAvailable`), and defaults price to 0 if not
 * given rather than leaving it null.
 *
 * @param {object} params
 * @param {string} params.businessId
 * @param {string} params.name - Must be unique within the business.
 * @param {string} params.unit - Unit of measure (e.g. "kg", "pcs").
 * @param {number|string} [params.price] - Parsed to a float; defaults to 0.
 * @param {number|string} [params.costPrice] - What the business pays for this
 *   product, distinct from `price`. Left null if not given - never defaulted
 *   to 0, since that would misrepresent an untracked cost as a known one.
 * @param {string} [params.description]
 * @param {string} [params.shortCode] - Optional fast-lookup code, must be unique.
 * @param {Array<{label: string, factor: number}>} [params.units] - Optional
 *   alternate pack sizes (e.g. "dozen" = 12 base units); price for each is
 *   always product.price * factor, never stored separately.
 * @returns {Promise<object>} The created product including its (empty) stock relation.
 * @throws {AppError} 409 if the name or short code is already taken.
 */
const createProduct = async ({ businessId, name, unit, price, costPrice, description, shortCode, units }) => {
  const existing = await prisma.product.findFirst({
    where: {
      businessId,
      deletedAt: null,
      name: { equals: name, mode: "insensitive" },
    },
  });

  if (existing) {
    throw new AppError("A product with this name already exists in this business", 409);
  }

  await assertShortCodeAvailable(businessId, shortCode);
  assertUnitsValid(unit, units);

  const product = await prisma.product.create({
    data: {
      businessId,
      name,
      unit,
      price: price ? parseFloat(price) : 0,
      costPrice: costPrice !== undefined ? parseFloat(costPrice) : undefined,
      description,
      shortCode,
      units: units && units.length > 0 ? { create: units } : undefined,
    },
    include: {
      units: true,
      stock: {
        include: {
          warehouse: {
            select: {
              id: true,
              name: true,
              isPrimary: true,
            },
          },
        },
      },
    },
  });

  return product;
};

/**
 * List all products for a business, each annotated with `totalQuantity`
 * (summed across every warehouse) and `primaryStock` (the stock row at the
 * business's primary warehouse, or null if none), so list views don't need
 * to re-derive these from the raw per-warehouse stock array. Every stock
 * row's `lowStockThreshold` is resolved to its effective value (explicit
 * override, or the business's per-unit/default rule) before it goes out, so
 * the frontend's `quantity <= lowStockThreshold` checks never need to know
 * about the rule themselves.
 *
 * @param {string} businessId
 * @param {{includeCostPrice?: boolean}} [options] - `costPrice` is stripped
 *   from every product unless this is true (only SUPERADMIN/ADMIN callers
 *   should ever pass it - see product.controller.js), since Employees can
 *   list products too (POS search) but must never see cost/margin data.
 * @returns {Promise<object[]>} Products ordered alphabetically by name.
 */
const getProducts = async (businessId, { includeCostPrice = false } = {}) => {
  const [products, thresholdSettings] = await Promise.all([
    prisma.product.findMany({
      where: { businessId, deletedAt: null },
      include: {
        units: true,
        stock: {
          include: {
            warehouse: {
              select: {
                id: true,
                name: true,
                isPrimary: true,
                location: true,
              },
            },
          },
        },
      },
      orderBy: { name: "asc" },
    }),
    getThresholdSettings(businessId),
  ]);

  const productsWithTotal = products.map((product) => {
    const stock = product.stock.map((s) => ({
      ...s,
      lowStockThreshold: resolveLowStockThreshold(s.lowStockThreshold, product.unit, thresholdSettings),
    }));
    const { costPrice, ...productWithoutCost } = product;
    return {
      ...(includeCostPrice ? product : productWithoutCost),
      stock,
      totalQuantity: stock.reduce((sum, s) => sum + s.quantity, 0),
      primaryStock: stock.find((s) => s.warehouse.isPrimary) || null,
    };
  });

  return productsWithTotal;
};

/**
 * Get a single product with its per-warehouse stock and its 10 most recent
 * sale line items (for a quick "recent activity" view), plus the same
 * derived `totalQuantity`/`primaryStock` fields as `getProducts`.
 *
 * @param {string} productId
 * @param {string} businessId - Scopes the lookup to this business.
 * @param {{includeCostPrice?: boolean}} [options] - See `getProducts`.
 * @returns {Promise<object>} The product with stock and recent transaction items.
 * @throws {AppError} 404 if not found in this business.
 */
const getProductById = async (productId, businessId, { includeCostPrice = false } = {}) => {
  const [product, thresholdSettings] = await Promise.all([
    prisma.product.findFirst({
      where: {
        id: productId,
        businessId,
        deletedAt: null,
      },
      include: {
        units: true,
        stock: {
          include: {
            warehouse: {
              select: {
                id: true,
                name: true,
                isPrimary: true,
                location: true,
              },
            },
          },
        },
        transactionItems: {
          take: 10,
          orderBy: { transaction: { createdAt: "desc" } },
          include: {
            transaction: {
              select: {
                id: true,
                createdAt: true,
                paymentMethod: true,
                performedBy: {
                  select: {
                    fullName: true,
                    username: true,
                  },
                },
              },
            },
          },
        },
      },
    }),
    getThresholdSettings(businessId),
  ]);

  if (!product) {
    throw new AppError("Product not found", 404);
  }

  const stock = product.stock.map((s) => ({
    ...s,
    lowStockThreshold: resolveLowStockThreshold(s.lowStockThreshold, product.unit, thresholdSettings),
  }));

  const { costPrice, ...productWithoutCost } = product;

  return {
    ...(includeCostPrice ? product : productWithoutCost),
    stock,
    totalQuantity: stock.reduce((sum, s) => sum + s.quantity, 0),
    primaryStock: stock.find((s) => s.warehouse.isPrimary) || null,
  };
};

/**
 * Update a product's fields. Re-validates uniqueness of `name` and
 * `shortCode` only when they're actually changing (comparing against the
 * current value first), to avoid a product tripping over its own existing
 * value during an update.
 *
 * @param {string} productId
 * @param {string} businessId - Scopes the lookup to this business.
 * @param {{name?: string, unit?: string, price?: number|string, costPrice?: number|string, description?: string, shortCode?: string, units?: Array<{label: string, factor: number}>}} fields
 *   `units`, when provided, wholesale-replaces the product's alternate pack
 *   sizes - safe because past sales/stock movements already have their own
 *   `unitLabel` denormalized onto them, so editing/removing a pack size
 *   later can't corrupt historical receipts.
 * @returns {Promise<object>} The updated product including stock.
 * @throws {AppError} 404 if not found; 409 if the new name/shortCode collides
 *   with another product in the business; 400 if `units` collide with each
 *   other or with the base unit.
 */
const updateProduct = async (productId, businessId, { name, unit, price, costPrice, description, shortCode, units }) => {
  const product = await prisma.product.findFirst({
    where: { id: productId, businessId, deletedAt: null },
  });

  if (!product) {
    throw new AppError("Product not found", 404);
  }

  if (name && name !== product.name) {
    const existing = await prisma.product.findFirst({
      where: {
        businessId,
        deletedAt: null,
        name: { equals: name, mode: "insensitive" },
        NOT: { id: productId },
      },
    });

    if (existing) {
      throw new AppError("A product with this name already exists", 409);
    }
  }

  if (shortCode && shortCode !== product.shortCode) {
    await assertShortCodeAvailable(businessId, shortCode, productId);
  }

  if (units !== undefined) {
    assertUnitsValid(unit ?? product.unit, units);
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (units !== undefined) {
      await tx.productUnit.deleteMany({ where: { productId } });
      if (units.length > 0) {
        await tx.productUnit.createMany({
          data: units.map((u) => ({ ...u, productId })),
        });
      }
    }

    return tx.product.update({
      where: { id: productId },
      data: {
        ...(name && { name }),
        ...(unit && { unit }),
        ...(price !== undefined && { price: parseFloat(price) }),
        ...(costPrice !== undefined && { costPrice: parseFloat(costPrice) }),
        ...(description !== undefined && { description }),
        ...(shortCode !== undefined && { shortCode }),
      },
      include: {
        units: true,
        stock: {
          include: {
            warehouse: {
              select: {
                id: true,
                name: true,
                isPrimary: true,
              },
            },
          },
        },
      },
    });
  });

  return updated;
};

/**
 * Soft-delete a product: hides it from the catalog/POS/pickers by setting
 * `deletedAt`, but never touches its `WarehouseStock`, `TransactionItem`, or
 * `StockMovement` rows, so historical sales/reports stay perfectly intact
 * regardless of transaction history. Records an audit entry in the same
 * transaction.
 *
 * @param {string} productId
 * @param {string} businessId - Scopes the lookup to this business.
 * @param {string} actorId - ID of the user performing the deletion.
 * @returns {Promise<{message: string}>}
 * @throws {AppError} 404 if not found.
 */
const deleteProduct = async (productId, businessId, actorId) => {
  const product = await prisma.product.findFirst({
    where: { id: productId, businessId, deletedAt: null },
  });

  if (!product) {
    throw new AppError("Product not found", 404);
  }

  const actor = await prisma.user.findUnique({ where: { id: actorId } });

  await prisma.$transaction(async (tx) => {
    // Also clears shortCode - it's a unique-per-business "quick lookup"
    // nickname (@@unique([businessId, shortCode])), so a deleted product
    // must give it up or it'd permanently block reuse by a future product.
    await tx.product.update({
      where: { id: productId },
      data: { deletedAt: new Date(), shortCode: null },
    });

    await recordAudit(tx, {
      businessId,
      actorId,
      actorName: actor?.fullName ?? null,
      action: "product.deleted",
      entityType: "Product",
      entityId: productId,
      metadata: { name: product.name },
    });
  });

  return { message: "Product deleted successfully" };
};

/**
 * List soft-deleted products for a business (the "Trash" view) — newest
 * deletion first. Doesn't include stock/units, since a deleted product's
 * only useful info here is "what was it and can I get it back."
 *
 * @param {string} businessId
 * @returns {Promise<object[]>}
 */
const getDeletedProducts = async (businessId) => {
  return prisma.product.findMany({
    where: { businessId, deletedAt: { not: null } },
    orderBy: { deletedAt: "desc" },
  });
};

/**
 * Restore a soft-deleted product by clearing `deletedAt`. Its `shortCode`
 * was cleared at delete time (to free the slot for reuse) and stays cleared
 * on restore — the product comes back into the catalog without one, and can
 * be given a new one via a normal update if wanted.
 *
 * @param {string} productId
 * @param {string} businessId - Scopes the lookup to this business.
 * @param {string} actorId
 * @returns {Promise<object>} The restored product.
 * @throws {AppError} 404 if not found among this business's deleted products.
 */
const restoreProduct = async (productId, businessId, actorId) => {
  const product = await prisma.product.findFirst({
    where: { id: productId, businessId, deletedAt: { not: null } },
  });

  if (!product) {
    throw new AppError("Deleted product not found", 404);
  }

  // A product's name is freed up for reuse the moment it's deleted (see
  // createProduct's uniqueness check, which also filters deletedAt: null) -
  // so a new active product may have already claimed this name while this
  // one was in the trash. Restoring it anyway would leave two active
  // products with the same name and nothing in the schema to catch that.
  const collision = await prisma.product.findFirst({
    where: {
      businessId,
      deletedAt: null,
      name: { equals: product.name, mode: "insensitive" },
    },
  });

  if (collision) {
    throw new AppError(
      `Can't restore: another active product is already named "${product.name}". Rename it first.`,
      409
    );
  }

  const actor = await prisma.user.findUnique({ where: { id: actorId } });

  const restored = await prisma.$transaction(async (tx) => {
    const result = await tx.product.update({
      where: { id: productId },
      data: { deletedAt: null },
    });

    await recordAudit(tx, {
      businessId,
      actorId,
      actorName: actor?.fullName ?? null,
      action: "product.restored",
      entityType: "Product",
      entityId: productId,
      metadata: { name: product.name },
    });

    return result;
  });

  return restored;
};

/**
 * Receive incoming stock (a restock/delivery) into one warehouse, for one or
 * more products at once. For each line item: increments existing stock (or
 * creates a new WarehouseStock row if the product has never stocked there),
 * optionally updates the low-stock threshold, then records a RESTOCK
 * StockMovement — all inside one `$transaction` so a delivery of several
 * products either fully applies or not at all, and the movement log always
 * matches the resulting stock levels.
 *
 * @param {object} params
 * @param {string} params.businessId
 * @param {string} params.warehouseId - Destination warehouse; must belong to businessId.
 * @param {Array<{productId: string, quantity: number, lowStockThreshold?: number, unitLabel?: string, unitQuantity?: number}>} params.items
 *   `unitLabel`/`unitQuantity` are display-only passthroughs (e.g. "3
 *   carton(s)") - `quantity` must already be the base-unit amount to apply
 *   to WarehouseStock; no conversion happens here.
 * @param {string} params.movedById - User who logged the delivery.
 * @param {string} [params.notes]
 * @returns {Promise<object[]>} One StockMovement record per item received.
 * @throws {AppError} 404 if the warehouse or any product doesn't belong to this business.
 */
const receiveStock = async ({ businessId, warehouseId, items, movedById, notes }) => {
  const warehouse = await prisma.warehouse.findFirst({
    where: { id: warehouseId, businessId, deletedAt: null },
  });

  if (!warehouse) {
    throw new AppError("Warehouse not found", 404);
  }

  const productIds = items.map((item) => item.productId);
  const products = await prisma.product.findMany({
    where: { id: { in: productIds }, businessId, deletedAt: null },
  });

  if (products.length !== new Set(productIds).size) {
    throw new AppError("One or more products were not found in this business", 404);
  }

  const movements = await prisma.$transaction(async (tx) => {
    const created = [];

    for (const { productId, quantity, lowStockThreshold, unitLabel, unitQuantity } of items) {
      const existingStock = await tx.warehouseStock.findUnique({
        where: { warehouseId_productId: { warehouseId, productId } },
      });

      if (existingStock) {
        await tx.warehouseStock.update({
          where: { warehouseId_productId: { warehouseId, productId } },
          data: {
            quantity: existingStock.quantity + quantity,
            ...(lowStockThreshold !== undefined && { lowStockThreshold }),
          },
        });
      } else {
        await tx.warehouseStock.create({
          data: {
            warehouseId,
            productId,
            quantity,
            // Left null (no explicit override) unless the caller set one -
            // governed instead by the business's live low-stock rule.
            lowStockThreshold: lowStockThreshold ?? null,
          },
        });
      }

      const movement = await tx.stockMovement.create({
        data: {
          businessId,
          fromWarehouseId: null,
          toWarehouseId: warehouseId,
          productId,
          quantity,
          unitLabel,
          unitQuantity,
          type: "RESTOCK",
          status: "COMPLETED",
          movedById,
          notes,
        },
        include: {
          toWarehouse: { select: { id: true, name: true } },
          product: { select: { id: true, name: true, unit: true } },
          movedBy: { select: { id: true, fullName: true, username: true } },
        },
      });

      created.push(movement);
    }

    return created;
  });

  return movements;
};

/**
 * Get all stock across all warehouses for a business, with each stock line
 * flagged `isLowStock` (quantity at or below its configured threshold) and
 * `isOutOfStock` (quantity exactly 0), so the frontend doesn't need to
 * recompute alert logic itself.
 *
 * @param {string} businessId
 * @returns {Promise<object[]>} Warehouses (primary first), each with its
 *   flagged stock list sorted lowest-quantity first.
 */
const getAllStock = async (businessId) => {
  const [warehouses, thresholdSettings] = await Promise.all([
    prisma.warehouse.findMany({
      where: { businessId, deletedAt: null },
      include: {
        stock: {
          where: { product: { deletedAt: null } },
          include: {
            product: {
              select: {
                id: true,
                name: true,
                unit: true,
                description: true,
              },
            },
          },
          orderBy: {
            quantity: "asc",
          },
        },
      },
      orderBy: [
        { isPrimary: "desc" },
        { createdAt: "asc" },
      ],
    }),
    getThresholdSettings(businessId),
  ]);

  // Resolve each row's effective threshold, then flag low/out-of-stock items.
  const warehousesWithAlerts = warehouses.map((warehouse) => ({
    ...warehouse,
    stock: warehouse.stock.map((item) => {
      const lowStockThreshold = resolveLowStockThreshold(
        item.lowStockThreshold,
        item.product.unit,
        thresholdSettings
      );
      return {
        ...item,
        lowStockThreshold,
        isLowStock: item.quantity <= lowStockThreshold,
        isOutOfStock: item.quantity === 0,
      };
    }),
  }));

  return warehousesWithAlerts;
};

/**
 * Move a quantity of one product from one warehouse to another (an internal
 * TRANSFER, distinct from a RESTOCK). Validates the source warehouse has
 * enough quantity before moving anything. The actual move — decrementing
 * the source, incrementing (or creating) the destination stock row, and
 * logging a TRANSFER StockMovement — happens inside a single
 * `$transaction` so stock can never end up deducted from the source
 * without also landing in the destination (or vice versa).
 *
 * @param {object} params
 * @param {string} params.businessId
 * @param {string} params.fromWarehouseId
 * @param {string} params.toWarehouseId - Must differ from fromWarehouseId.
 * @param {string} params.productId
 * @param {number} params.quantity - Must be > 0 and <= current source stock.
 * @param {string} params.movedById
 * @param {string} [params.notes]
 * @returns {Promise<object>} The created StockMovement record.
 * @throws {AppError} If source/destination are the same, quantity is
 *   invalid, the product has no stock at the source, or source stock is
 *   insufficient.
 */
const moveStock = async ({
  businessId,
  fromWarehouseId,
  toWarehouseId,
  productId,
  quantity,
  movedById,
  notes,
}) => {
  if (fromWarehouseId === toWarehouseId) {
    throw new AppError("Cannot move stock to the same warehouse");
  }

  if (quantity <= 0) {
    throw new AppError("Quantity must be greater than 0");
  }

  // Check source stock
  const sourceStock = await prisma.warehouseStock.findUnique({
    where: {
      warehouseId_productId: {
        warehouseId: fromWarehouseId,
        productId,
      },
    },
    include: {
      product: true,
      warehouse: true,
    },
  });

  if (!sourceStock) {
    throw new AppError("Product not found in source warehouse", 404);
  }

  if (sourceStock.quantity < quantity) {
    throw new AppError(
      `Insufficient stock. Available: ${sourceStock.quantity} ${sourceStock.product.unit}`
    );
  }

  // Perform the stock movement in a transaction
  const result = await prisma.$transaction(async (tx) => {
    // Deduct from source warehouse
    await tx.warehouseStock.update({
      where: {
        warehouseId_productId: {
          warehouseId: fromWarehouseId,
          productId,
        },
      },
      data: {
        quantity: sourceStock.quantity - quantity,
      },
    });

    // Add to destination warehouse
    const destStock = await tx.warehouseStock.findUnique({
      where: {
        warehouseId_productId: {
          warehouseId: toWarehouseId,
          productId,
        },
      },
    });

    if (destStock) {
      await tx.warehouseStock.update({
        where: {
          warehouseId_productId: {
            warehouseId: toWarehouseId,
            productId,
          },
        },
        data: {
          quantity: destStock.quantity + quantity,
        },
      });
    } else {
      await tx.warehouseStock.create({
        data: {
          warehouseId: toWarehouseId,
          productId,
          quantity,
        },
      });
    }

    // Record the movement
    const movement = await tx.stockMovement.create({
      data: {
        businessId,
        fromWarehouseId,
        toWarehouseId,
        productId,
        quantity,
        movedById,
        notes,
        type: "TRANSFER",
        status: "COMPLETED",
      },
      include: {
        fromWarehouse: {
          select: { id: true, name: true },
        },
        toWarehouse: {
          select: { id: true, name: true },
        },
        product: {
          select: { id: true, name: true, unit: true },
        },
        movedBy: {
          select: { id: true, fullName: true, username: true },
        },
      },
    });

    return movement;
  });

  return result;
};

/**
 * Get stock movement history for a business (both RESTOCK and TRANSFER
 * entries), with optional filters for date range, source/destination
 * warehouse, product, and movement type — powers the stock-movements
 * report/audit trail screen.
 *
 * @param {string} businessId
 * @param {{startDate?: string, endDate?: string, fromWarehouseId?: string, toWarehouseId?: string, productId?: string, type?: string}} [filters]
 * @returns {Promise<object[]>} Movements newest first.
 */
const getStockMovements = async (businessId, filters = {}) => {
  const { startDate, endDate, fromWarehouseId, toWarehouseId, productId, type } = filters;

  const where = { businessId };
  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt.gte = startOfDay(new Date(startDate));
    if (endDate) where.createdAt.lte = endOfDay(new Date(endDate));
  }
  if (fromWarehouseId) where.fromWarehouseId = fromWarehouseId;
  if (toWarehouseId) where.toWarehouseId = toWarehouseId;
  if (productId) where.productId = productId;
  if (type) where.type = type;

  const movements = await prisma.stockMovement.findMany({
    where,
    include: {
      fromWarehouse: {
        select: { id: true, name: true },
      },
      toWarehouse: {
        select: { id: true, name: true },
      },
      product: {
        select: { id: true, name: true, unit: true },
      },
      movedBy: {
        select: { id: true, fullName: true, username: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return movements;
};

module.exports = {
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
};