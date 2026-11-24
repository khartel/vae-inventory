const prisma = require('../utils/prisma');
const {
  Prisma
} = require('@prisma/client');
const {
  createHash
} = require('crypto');
const AppError = require('../utils/AppError');
const {
  recordAudit
} = require('../utils/auditLog');
const D = x => new Prisma.Decimal(x);
const include = {
  supplier: true,
  warehouse: {
    select: {
      id: true,
      name: true
    }
  },
  items: {
    orderBy: {
      id: 'asc'
    }
  },
  receipts: {
    orderBy: {
      createdAt: 'desc'
    },
    include: {
      items: true
    }
  }
};
const view = o => ({
  ...o,
  totalAmount: o.items.reduce((s, i) => s.plus(D(i.quantity).mul(i.unitCost)), D(0)).toDecimalPlaces(2).toNumber(),
  receivedAmount: o.items.reduce((s, i) => s.plus(D(i.receivedQuantity).mul(i.unitCost)), D(0)).toDecimalPlaces(2).toNumber(),
  leadTimeDays: o.receivedAt && o.orderedAt ? Math.max(0, (o.receivedAt - o.orderedAt) / 86400000) : null,
  items: o.items.map(i => ({
    ...i,
    quantity: Number(i.quantity),
    receivedQuantity: Number(i.receivedQuantity),
    unitCost: Number(i.unitCost)
  })),
  receipts: o.receipts.map(r => ({
    ...r,
    items: r.items.map(i => ({
      ...i,
      quantity: Number(i.quantity)
    }))
  }))
});
const get = async (tx, businessId, id) => {
  const o = await tx.purchaseOrder.findFirst({
    where: {
      id,
      businessId
    },
    include
  });
  if (!o) throw new AppError('Purchase order not found', 404);
  return o;
};
const isSerializationConflict = (e) =>
  e?.code === 'P2034' ||
  e?.meta?.code === '40001' ||
  e?.meta?.driverAdapterError?.cause?.originalCode === '40001' ||
  e?.meta?.driverAdapterError?.cause?.kind === 'TransactionWriteConflict';

// Serializable receipt/edit transactions avoid concurrent over-receiving and
// stale drafts. Retry only serialization conflicts; all other failures surface.
async function atomic(fn) {
  for (let n = 0; n < 3; n++) {
    try {
      return await prisma.$transaction(fn, {
        isolationLevel: 'Serializable',
        timeout: 15000
      });
    } catch (e) {
      if (!isSerializationConflict(e) || n === 2) throw e;
    }
  }
}
const audit = (tx, businessId, actor, action, entityType, entityId, metadata = {}) => recordAudit(tx, {
  businessId,
  actorId: actor.id,
  actorName: actor.fullName || actor.username,
  action,
  entityType,
  entityId,
  metadata
});
async function checkReferences(tx, businessId, data) {
  const supplier = await tx.supplier.findFirst({
    where: {
      id: data.supplierId,
      businessId,
      archivedAt: null
    }
  });
  const warehouse = await tx.warehouse.findFirst({
    where: {
      id: data.warehouseId,
      businessId,
      deletedAt: null
    }
  });
  if (!supplier || !warehouse) throw new AppError('Select an active supplier and warehouse in this business', 400);
  const products = await tx.product.findMany({
    where: {
      id: {
        in: data.items.map(i => i.productId)
      },
      businessId,
      deletedAt: null
    }
  });
  if (products.length !== data.items.length) throw new AppError('Select active products from this business', 400);
  return {
    supplier,
    items: data.items.map(i => {
      const p = products.find(p => p.id === i.productId);
      return {
        ...i,
        productName: p.name,
        unit: p.unit
      };
    })
  };
}
async function lock(tx, o, version) {
  const r = await tx.purchaseOrder.updateMany({
    where: {
      id: o.id,
      businessId: o.businessId,
      version
    },
    data: {
      version: {
        increment: 1
      }
    }
  });
  if (!r.count) throw new AppError('This order changed. Refresh and try again.', 409);
}
exports.listSuppliers = async (businessId, q) => {
  const where = {
    businessId,
    archivedAt: q.archived === 'true' ? {
      not: null
    } : null,
    ...(q.search && {
      name: {
        contains: q.search,
        mode: 'insensitive'
      }
    })
  };
  const [rows, total] = await prisma.$transaction([prisma.supplier.findMany({
    where,
    orderBy: {
      name: 'asc'
    },
    skip: (q.page - 1) * q.limit,
    take: q.limit,
    include: {
      _count: {
        select: {
          orders: true
        }
      }
    }
  }), prisma.supplier.count({
    where
  })]);
  return {
    rows,
    total,
    page: q.page,
    totalPages: Math.ceil(total / q.limit)
  };
};
exports.saveSupplier = (businessId, id, data, actor) => atomic(async tx => {
  if (id && !(await tx.supplier.findFirst({
    where: {
      id,
      businessId
    }
  }))) throw new AppError('Supplier not found', 404);
  const row = id ? await tx.supplier.update({
    where: {
      id
    },
    data: {
      ...data,
      email: data.email || null
    }
  }) : await tx.supplier.create({
    data: {
      ...data,
      email: data.email || null,
      businessId
    }
  });
  await audit(tx, businessId, actor, id ? 'SUPPLIER_UPDATED' : 'SUPPLIER_CREATED', 'Supplier', row.id, {
    name: row.name
  });
  return row;
});
exports.archiveSupplier = (businessId, id, actor, restore = false) => atomic(async tx => {
  if (!(await tx.supplier.findFirst({
    where: {
      id,
      businessId
    }
  }))) throw new AppError('Supplier not found', 404);
  const row = await tx.supplier.update({
    where: {
      id
    },
    data: {
      archivedAt: restore ? null : new Date()
    }
  });
  await audit(tx, businessId, actor, restore ? 'SUPPLIER_RESTORED' : 'SUPPLIER_ARCHIVED', 'Supplier', id);
  return row;
});
exports.listOrders = async (businessId, q) => {
  const where = {
    businessId,
    ...(q.status && {
      status: q.status
    }),
    ...(q.search && {
      supplierName: {
        contains: q.search,
        mode: 'insensitive'
      }
    })
  };
  const [rows, total] = await prisma.$transaction([prisma.purchaseOrder.findMany({
    where,
    include,
    orderBy: [{
      createdAt: 'desc'
    }, {
      id: 'desc'
    }],
    skip: (q.page - 1) * q.limit,
    take: q.limit
  }), prisma.purchaseOrder.count({
    where
  })]);
  return {
    rows: rows.map(view),
    total,
    page: q.page,
    totalPages: Math.ceil(total / q.limit)
  };
};
exports.getOrder = async (businessId, id) => view(await get(prisma, businessId, id));
exports.saveOrder = (businessId, id, data, actor) => atomic(async tx => {
  let o;
  if (id) {
    o = await get(tx, businessId, id);
    if (o.status !== 'DRAFT') throw new AppError('Only draft orders can be edited', 409);
    await lock(tx, o, data.version);
  }
  const refs = await checkReferences(tx, businessId, data);
  const fields = {
    supplierId: data.supplierId,
    supplierName: refs.supplier.name,
    warehouseId: data.warehouseId,
    notes: data.notes || null,
    expectedAt: data.expectedAt ? new Date(data.expectedAt) : null
  };
  if (id) {
    await tx.purchaseOrderItem.deleteMany({
      where: {
        orderId: id
      }
    });
    await tx.purchaseOrder.update({
      where: {
        id
      },
      data: {
        ...fields,
        items: {
          create: refs.items
        }
      }
    });
  } else {
    o = await tx.purchaseOrder.create({
      data: {
        ...fields,
        businessId,
        items: {
          create: refs.items
        }
      }
    });
    id = o.id;
  }
  await audit(tx, businessId, actor, 'PURCHASE_DRAFT_SAVED', 'PurchaseOrder', id);
  return view(await get(tx, businessId, id));
});
exports.transition = (businessId, id, data, actor) => atomic(async tx => {
  const o = await get(tx, businessId, id);
  if (data.action === 'ORDER') {
    if (o.status !== 'DRAFT') throw new AppError('Only drafts can be marked ordered', 409);
    const refs = await checkReferences(tx, businessId, o);
    await lock(tx, o, data.version);
    await tx.purchaseOrder.update({
      where: {
        id
      },
      data: {
        status: 'ORDERED',
        orderedAt: new Date(),
        supplierName: refs.supplier.name
      }
    });
  } else {
    if (['RECEIVED', 'CANCELLED'].includes(o.status)) throw new AppError('This order cannot be cancelled', 409);
    await lock(tx, o, data.version);
    await tx.purchaseOrder.update({
      where: {
        id
      },
      data: {
        status: 'CANCELLED'
      }
    });
  }
  await audit(tx, businessId, actor, data.action === 'ORDER' ? 'PURCHASE_ORDERED' : 'PURCHASE_CANCELLED', 'PurchaseOrder', id);
  return view(await get(tx, businessId, id));
});
exports.receive = (businessId, id, data, actor) => atomic(async tx => {
  const o = await get(tx, businessId, id);
  const hash = createHash('sha256').update(JSON.stringify([...data.items].sort((a, b) => a.orderItemId.localeCompare(b.orderItemId)))).digest('hex');
  const previous = o.receipts.find(r => r.requestId === data.requestId);
  if (previous) {
    if (previous.payloadHash !== hash) throw new AppError('Receipt reference was already used for different quantities', 409);
    return view(o);
  }
  if (!['ORDERED', 'PARTIALLY_RECEIVED'].includes(o.status)) throw new AppError('Only ordered purchases can be received', 409);
  await lock(tx, o, data.version);
  // Join the same Warehouse FOR NO KEY UPDATE lock protocol used by manual
  // stock writers so concurrent warehouse deletion cannot race purchase receipt.
  const lockedWarehouses = await tx.$queryRaw`
    SELECT id, "deletedAt" FROM "Warehouse"
    WHERE id = ${o.warehouseId} AND "businessId" = ${businessId}
    FOR NO KEY UPDATE
  `;
  if (!lockedWarehouses.length || lockedWarehouses[0].deletedAt) {
    throw new AppError('The receiving warehouse is no longer active', 409);
  }
  const receipt = await tx.purchaseReceipt.create({
    data: {
      orderId: id,
      requestId: data.requestId,
      payloadHash: hash,
      actorId: actor.id,
      actorName: actor.fullName || actor.username
    }
  });
  for (const line of data.items) {
    const item = o.items.find(i => i.id === line.orderItemId);
    if (!item || D(line.quantity).gt(D(item.quantity).minus(item.receivedQuantity))) throw new AppError('Received quantity exceeds the remaining order quantity', 400);
    if (!(await tx.product.findFirst({
      where: {
        id: item.productId,
        businessId,
        deletedAt: null
      }
    }))) throw new AppError('An ordered product is no longer active', 409);
    await tx.purchaseOrderItem.update({
      where: {
        id: item.id
      },
      data: {
        receivedQuantity: {
          increment: line.quantity
        }
      }
    });
    await tx.purchaseReceiptItem.create({
      data: {
        receiptId: receipt.id,
        orderItemId: item.id,
        quantity: line.quantity
      }
    });
    await tx.warehouseStock.upsert({
      where: {
        warehouseId_productId: {
          warehouseId: o.warehouseId,
          productId: item.productId
        }
      },
      create: {
        warehouseId: o.warehouseId,
        productId: item.productId,
        quantity: line.quantity
      },
      update: {
        quantity: {
          increment: line.quantity
        }
      }
    });
    await tx.product.update({
      where: {
        id: item.productId
      },
      data: {
        costPrice: Number(item.unitCost)
      }
    });
    await tx.stockMovement.create({
      data: {
        businessId,
        toWarehouseId: o.warehouseId,
        productId: item.productId,
        quantity: line.quantity,
        batchId: receipt.id,
        type: 'RESTOCK',
        status: 'COMPLETED',
        movedById: actor.id,
        notes: `PO ${id} / receipt ${receipt.id}`
      }
    });
  }
  const items = await tx.purchaseOrderItem.findMany({
    where: {
      orderId: id
    }
  });
  const complete = items.every(i => D(i.receivedQuantity).eq(i.quantity));
  await tx.purchaseOrder.update({
    where: {
      id
    },
    data: {
      status: complete ? 'RECEIVED' : 'PARTIALLY_RECEIVED',
      receivedAt: complete ? new Date() : null
    }
  });
  await audit(tx, businessId, actor, 'PURCHASE_RECEIVED', 'PurchaseOrder', id, {
    receiptId: receipt.id,
    items: data.items
  });
  return view(await get(tx, businessId, id));
});
