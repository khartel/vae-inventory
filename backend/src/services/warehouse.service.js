const prisma = require("../utils/prisma");
const AppError = require("../utils/AppError");
const { recordAudit } = require("../utils/auditLog");
const { getThresholdSettings, resolveLowStockThreshold } = require("../utils/lowStockThreshold");

// A business exists before its first warehouse, so it is the stable lock target
// for both first-location creation and primary-location changes. NO KEY UPDATE
// still serializes these writers but permits business FK checks from stock
// audits while deletion waits for a stock writer's Warehouse lock.
const lockBusiness = async (tx, businessId) => {
  const rows = await tx.$queryRaw`
    SELECT id FROM "Business" WHERE id = ${businessId} FOR NO KEY UPDATE
  `;
  if (!rows.length) throw new AppError("Business not found", 404);
};

/**
 * Create a new warehouse for a business. Enforces the invariant that a
 * business has exactly one primary warehouse at a time (the one sales are
 * fulfilled from and stock reports default to): if `isPrimary` is
 * requested, all other warehouses are demoted first. Additionally, the
 * very first warehouse a business creates is always made primary
 * automatically, even if not explicitly requested, so a business is never
 * left without one (which would block making sales).
 *
 * @param {object} params
 * @param {string} params.businessId
 * @param {string} params.name
 * @param {string} params.location
 * @param {boolean} [params.isPrimary]
 * @param {string} [params.userId] - Currently unused; reserved for auditing.
 * @returns {Promise<object>} The created warehouse.
 * @throws {AppError} 404 if the business doesn't exist.
 */
const createWarehouse = async ({ businessId, name, location, isPrimary, userId }) => {
  const warehouse = await prisma.$transaction(async (tx) => {
    await lockBusiness(tx, businessId);
    // If this warehouse is set as primary, demote all others atomically
    if (isPrimary) {
      await tx.warehouse.updateMany({
        where: { businessId },
        data: { isPrimary: false },
      });
    }

    // If this is the first (active) warehouse, make it primary automatically
    const warehouseCount = await tx.warehouse.count({
      where: { businessId, deletedAt: null },
    });

    const shouldBePrimary = isPrimary || warehouseCount === 0;

    return tx.warehouse.create({
      data: {
        businessId,
        name,
        location,
        isPrimary: shouldBePrimary,
      },
      include: {
        _count: {
          select: {
            stock: { where: { product: { deletedAt: null } } },
          },
        },
      },
    });
  });

  return warehouse;
};

/**
 * List all warehouses for a business with their stock and activity counts,
 * primary warehouse first (then by creation order).
 *
 * @param {string} businessId
 * @returns {Promise<object[]>}
 */
const getWarehouses = async (businessId) => {
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
              },
            },
          },
        },
        _count: {
          select: {
            stock: { where: { product: { deletedAt: null } } },
            transactions: true,
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

  return warehouses.map((warehouse) => ({
    ...warehouse,
    stock: warehouse.stock.map((s) => ({
      ...s,
      lowStockThreshold: resolveLowStockThreshold(s.lowStockThreshold, s.product.unit, thresholdSettings),
    })),
  }));
};

/**
 * Get a single warehouse with its stock (lowest quantity first, to surface
 * items needing attention) and activity counts.
 *
 * @param {string} warehouseId
 * @param {string} businessId - Scopes the lookup to this business.
 * @returns {Promise<object>}
 * @throws {AppError} 404 if not found in this business.
 */
const getWarehouseById = async (warehouseId, businessId) => {
  const [warehouse, thresholdSettings] = await Promise.all([
    prisma.warehouse.findFirst({
      where: {
        id: warehouseId,
        businessId,
        deletedAt: null,
      },
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
        _count: {
          select: {
            stock: { where: { product: { deletedAt: null } } },
            transactions: true,
          },
        },
      },
    }),
    getThresholdSettings(businessId),
  ]);

  if (!warehouse) {
    throw new AppError("Warehouse not found", 404);
  }

  return {
    ...warehouse,
    stock: warehouse.stock.map((s) => ({
      ...s,
      lowStockThreshold: resolveLowStockThreshold(s.lowStockThreshold, s.product.unit, thresholdSettings),
    })),
  };
};

/**
 * Promote a warehouse to be the business's primary one, demoting whichever
 * warehouse held that status before. Since sales are always fulfilled from
 * the primary warehouse, this effectively switches which stock pool the
 * register sells against going forward.
 *
 * @param {string} warehouseId
 * @param {string} businessId - Scopes the lookup to this business.
 * @returns {Promise<object>} The now-primary warehouse.
 * @throws {AppError} 404 if not found in this business.
 */
const setPrimaryWarehouse = async (warehouseId, businessId) => {
  // Demote all warehouses and promote this one atomically so the business is
  // never momentarily left without a primary warehouse.
  const updated = await prisma.$transaction(async (tx) => {
    await lockBusiness(tx, businessId);
    const warehouse = await tx.warehouse.findFirst({
      where: { id: warehouseId, businessId, deletedAt: null },
    });
    if (!warehouse) throw new AppError("Warehouse not found", 404);

    await tx.warehouse.updateMany({
      where: { businessId },
      data: { isPrimary: false },
    });

    return tx.warehouse.update({
      where: { id: warehouseId },
      data: { isPrimary: true },
    });
  });

  return updated;
};

/**
 * Update a warehouse's name and/or location. Does not touch `isPrimary` —
 * use `setPrimaryWarehouse` for that.
 *
 * @param {string} warehouseId
 * @param {string} businessId - Scopes the lookup to this business.
 * @param {{name?: string, location?: string}} fields
 * @returns {Promise<object>} The updated warehouse.
 * @throws {AppError} 404 if not found in this business.
 */
const updateWarehouse = async (warehouseId, businessId, { name, location }) => {
  const warehouse = await prisma.warehouse.findFirst({
    where: { id: warehouseId, businessId, deletedAt: null },
  });

  if (!warehouse) {
    throw new AppError("Warehouse not found", 404);
  }

  const updated = await prisma.warehouse.update({
    where: { id: warehouseId },
    data: {
      ...(name && { name }),
      ...(location && { location }),
    },
  });

  return updated;
};

/**
 * Soft-delete a warehouse. Two safety rules still apply since they're about
 * *current* operational state, not history: the primary warehouse can never
 * be deleted directly (another one must be promoted first via
 * `setPrimaryWarehouse`), and a warehouse still holding any stock can't be
 * deleted until that stock is moved elsewhere via `moveStock`. Once past
 * those, the warehouse is simply hidden (`deletedAt` set) — its
 * `Transaction`/`StockMovement` history is never touched, since nothing is
 * actually deleted at the database level. Records an audit entry in the
 * same transaction.
 *
 * @param {string} warehouseId
 * @param {string} businessId - Scopes the lookup to this business.
 * @param {string} actorId - ID of the user performing the deletion.
 * @returns {Promise<{message: string}>}
 * @throws {AppError} 404 if not found; error if it's primary or still has stock.
 */
const deleteWarehouse = async (warehouseId, businessId, actorId) => {
  const actor = await prisma.user.findUnique({ where: { id: actorId } });

  await prisma.$transaction(async (tx) => {
    await lockBusiness(tx, businessId);
    // Incoming-stock writers hold FOR NO KEY UPDATE on this same row. Take
    // the deletion lock before reading state/counts so either their committed
    // stock is visible here or they see deletedAt after this transaction.
    await tx.$queryRaw`
      SELECT id FROM "Warehouse"
      WHERE id = ${warehouseId} AND "businessId" = ${businessId}
      FOR UPDATE
    `;
    const warehouse = await tx.warehouse.findFirst({
      where: { id: warehouseId, businessId, deletedAt: null },
    });
    if (!warehouse) throw new AppError("Warehouse not found", 404);
    if (warehouse.isPrimary) {
      throw new AppError("Cannot delete the primary warehouse. Set another warehouse as primary first.");
    }

    const stockCount = await tx.warehouseStock.count({
      where: { warehouseId, quantity: { gt: 0 } },
    });
    if (stockCount > 0) {
      throw new AppError("Cannot delete a warehouse that has stock. Move stock to another warehouse first.");
    }

    await tx.warehouse.update({
      where: { id: warehouseId },
      data: { deletedAt: new Date() },
    });

    await recordAudit(tx, {
      businessId,
      actorId,
      actorName: actor?.fullName ?? null,
      action: "warehouse.deleted",
      entityType: "Warehouse",
      entityId: warehouseId,
      metadata: { name: warehouse.name },
    });
  });

  return { message: "Warehouse deleted successfully" };
};

/**
 * List soft-deleted warehouses for a business (the "Trash" view), newest
 * deletion first.
 *
 * @param {string} businessId
 * @returns {Promise<object[]>}
 */
const getDeletedWarehouses = async (businessId) => {
  return prisma.warehouse.findMany({
    where: { businessId, deletedAt: { not: null } },
    orderBy: { deletedAt: "desc" },
  });
};

/**
 * Restore a soft-deleted warehouse by clearing `deletedAt`. It comes back
 * as a non-primary warehouse regardless of what it was before deletion —
 * `deleteWarehouse` already refuses to delete the primary warehouse, so a
 * deleted one was never primary to begin with.
 *
 * @param {string} warehouseId
 * @param {string} businessId - Scopes the lookup to this business.
 * @param {string} actorId
 * @returns {Promise<object>} The restored warehouse.
 * @throws {AppError} 404 if not found among this business's deleted warehouses.
 */
const restoreWarehouse = async (warehouseId, businessId, actorId) => {
  const warehouse = await prisma.warehouse.findFirst({
    where: { id: warehouseId, businessId, deletedAt: { not: null } },
  });

  if (!warehouse) {
    throw new AppError("Deleted warehouse not found", 404);
  }

  const actor = await prisma.user.findUnique({ where: { id: actorId } });

  const restored = await prisma.$transaction(async (tx) => {
    const result = await tx.warehouse.update({
      where: { id: warehouseId },
      data: { deletedAt: null },
    });

    await recordAudit(tx, {
      businessId,
      actorId,
      actorName: actor?.fullName ?? null,
      action: "warehouse.restored",
      entityType: "Warehouse",
      entityId: warehouseId,
      metadata: { name: warehouse.name },
    });

    return result;
  });

  return restored;
};

module.exports = {
  createWarehouse,
  getWarehouses,
  getWarehouseById,
  setPrimaryWarehouse,
  updateWarehouse,
  deleteWarehouse,
  getDeletedWarehouses,
  restoreWarehouse,
};
