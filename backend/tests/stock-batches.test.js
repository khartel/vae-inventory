const prisma = require("../src/utils/prisma");
const { app, request, createSuperAdminWithBusiness, addAndLoginTeamMember } = require("./helpers");

// Hold a target row in an open transaction until every competing HTTP request
// is demonstrably queued behind it in PostgreSQL, guaranteeing real overlap.
async function blockedRace(lockRow, operations) {
  let release;
  let ready;
  const gate = new Promise((resolve) => { release = resolve; });
  const started = new Promise((resolve) => { ready = resolve; });
  const blocker = prisma.$transaction(async (tx) => {
    await lockRow(tx);
    const [{ pid }] = await tx.$queryRaw`SELECT pg_backend_pid() AS pid`;
    ready(pid);
    await gate;
  }, { timeout: 10000 });
  const pid = await Promise.race([started, blocker]);
  const pending = operations.map((operation) => operation().then((result) => result));
  try {
    const deadline = Date.now() + 3000;
    let blocked = 0;
    while (Date.now() < deadline) {
      const [row] = await prisma.$queryRaw`
        WITH RECURSIVE waiting AS (
          SELECT pid FROM pg_stat_activity WHERE pid = ${pid}
          UNION
          SELECT a.pid FROM pg_stat_activity a
          JOIN waiting w ON w.pid = ANY(pg_blocking_pids(a.pid))
          WHERE a.datname = current_database()
        )
        SELECT (COUNT(*) - 1)::int AS count FROM waiting
      `;
      blocked = row.count;
      if (blocked >= operations.length) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(blocked).toBeGreaterThanOrEqual(operations.length);
  } finally {
    release();
    await Promise.allSettled([blocker, ...pending]);
    await blocker;
  }
  return Promise.all(pending);
}

async function fixture() {
  const owner = await createSuperAdminWithBusiness();
  const businessId = owner.business.id;
  const source = await prisma.warehouse.create({ data: { businessId, name: "Warehouse 1" } });
  const destination = await prisma.warehouse.create({ data: { businessId, name: "Main" } });
  const products = [];
  for (const name of ["Rice", "Oil"]) {
    const product = await prisma.product.create({ data: { businessId, name, unit: "pcs", price: 10 } });
    await prisma.warehouseStock.create({ data: { warehouseId: source.id, productId: product.id, quantity: 100 } });
    products.push(product);
  }
  return { owner, businessId, source, destination, products };
}

function transfer(f, items) {
  return request(app).post(`/api/businesses/${f.businessId}/stock/move-bulk`).set("Cookie", f.owner.cookie).send({
    fromWarehouseId: f.source.id, toWarehouseId: f.destination.id, items, notes: "Replenishment",
  });
}

test("bulk transfers share one batch, preserve quantities, and keep later moves separate", async () => {
  const f = await fixture();
  const items = f.products.map((product) => ({ productId: product.id, quantity: 24, unitQuantity: 2, unitLabel: "dozen" }));
  const first = await transfer(f, items);
  expect(first.status).toBe(201);
  expect(first.body.data.movements).toHaveLength(2);
  expect(new Set(first.body.data.movements.map((movement) => movement.batchId))).toEqual(new Set([first.body.data.batchId]));
  expect(first.body.data.movements[0]).toMatchObject({ quantity: 24, unitLabel: "dozen", unitQuantity: 2 });
  const second = await transfer(f, items);
  expect(second.status).toBe(201);
  expect(second.body.data.batchId).not.toBe(first.body.data.batchId);
  const stock = await prisma.warehouseStock.findMany({ where: { warehouseId: f.source.id } });
  expect(stock.map((entry) => entry.quantity)).toEqual([52, 52]);
  const history = await request(app).get(`/api/businesses/${f.businessId}/stock/movements`).set("Cookie", f.owner.cookie);
  expect(history.body.data.filter((movement) => movement.batchId === first.body.data.batchId)).toHaveLength(2);
});

test("insufficient stock in a later line rolls back every stock change and movement", async () => {
  const f = await fixture();
  const sorted = [...f.products].sort((a, b) => a.id.localeCompare(b.id));
  const result = await transfer(f, [{ productId: sorted[0].id, quantity: 10 }, { productId: sorted[1].id, quantity: 101 }]);
  expect(result.status).toBe(400);
  expect(await prisma.stockMovement.count({ where: { businessId: f.businessId } })).toBe(0);
  expect(await prisma.warehouseStock.count({ where: { warehouseId: f.destination.id } })).toBe(0);
  const stock = await prisma.warehouseStock.findMany({ where: { warehouseId: f.source.id } });
  expect(stock.map((entry) => entry.quantity)).toEqual([100, 100]);
});

test("competing bulk transfers cannot overdraw the same source stock", async () => {
  const f = await fixture();
  const items = f.products.map((product) => ({ productId: product.id, quantity: 60 }));
  const results = await Promise.all([transfer(f, items), transfer(f, [...items].reverse())]);
  expect(results.map((result) => result.status).sort()).toEqual([201, 400]);
  const stock = await prisma.warehouseStock.findMany({ where: { warehouseId: f.source.id } });
  expect(stock.map((entry) => entry.quantity)).toEqual([40, 40]);
  expect(await prisma.stockMovement.count({ where: { businessId: f.businessId } })).toBe(2);
});

test("rejects duplicate products, empty batches, invalid quantities, and the same route endpoints", async () => {
  const f = await fixture();
  const item = { productId: f.products[0].id, quantity: 1 };
  for (const items of [[], [item, item], [{ ...item, quantity: 0 }], [{ ...item, quantity: -1 }]]) {
    expect((await transfer(f, items)).status).toBe(400);
  }
  const same = await request(app).post(`/api/businesses/${f.businessId}/stock/move-bulk`).set("Cookie", f.owner.cookie).send({
    fromWarehouseId: f.source.id, toWarehouseId: f.source.id, items: [item],
  });
  expect(same.status).toBe(400);
  expect(await prisma.stockMovement.count({ where: { businessId: f.businessId } })).toBe(0);
});

test("blocks other businesses' products and employee mutation access", async () => {
  const f = await fixture();
  const other = await createSuperAdminWithBusiness();
  const foreign = await prisma.product.create({ data: { businessId: other.business.id, name: "Foreign rice", unit: "pcs", price: 1 } });
  expect((await transfer(f, [{ productId: foreign.id, quantity: 1 }])).status).toBe(404);
  const employee = await addAndLoginTeamMember(f.owner.cookie, f.businessId);
  const denied = await request(app).post(`/api/businesses/${f.businessId}/stock/move-bulk`).set("Cookie", employee.cookie).send({
    fromWarehouseId: f.source.id, toWarehouseId: f.destination.id, items: [{ productId: f.products[0].id, quantity: 1 }],
  });
  expect(denied.status).toBe(403);
});

test("receiving several products records one delivery batch", async () => {
  const f = await fixture();
  const result = await request(app).post(`/api/businesses/${f.businessId}/stock/receive`).set("Cookie", f.owner.cookie).send({
    warehouseId: f.destination.id, items: f.products.map((product) => ({ productId: product.id, quantity: 10 })),
  });
  expect(result.status).toBe(201);
  const ids = result.body.data.map((movement) => movement.batchId);
  expect(ids).toHaveLength(2);
  expect(ids[0]).toBeTruthy();
  expect(new Set(ids).size).toBe(1);
});

test("single-product callers still receive the original movement response", async () => {
  const f = await fixture();
  const result = await request(app).post(`/api/businesses/${f.businessId}/stock/move`).set("Cookie", f.owner.cookie).send({
    fromWarehouseId: f.source.id, toWarehouseId: f.destination.id, productId: f.products[0].id, quantity: 2,
  });
  expect(result.status).toBe(201);
  expect(result.body.data).toMatchObject({ productId: f.products[0].id, quantity: 2, type: "TRANSFER", batchId: expect.any(String) });
});

test("opposing concurrent bulk transfers (A -> B and B -> A) both succeed without deadlocking", async () => {
  const f = await fixture();
  for (const product of f.products) {
    await prisma.warehouseStock.create({ data: { warehouseId: f.destination.id, productId: product.id, quantity: 100 } });
  }
  const items = f.products.map((product) => ({ productId: product.id, quantity: 15 }));
  const forward = request(app).post(`/api/businesses/${f.businessId}/stock/move-bulk`).set("Cookie", f.owner.cookie).send({
    fromWarehouseId: f.source.id, toWarehouseId: f.destination.id, items, notes: "A to B",
  });
  const backward = request(app).post(`/api/businesses/${f.businessId}/stock/move-bulk`).set("Cookie", f.owner.cookie).send({
    fromWarehouseId: f.destination.id, toWarehouseId: f.source.id, items: [...items].reverse(), notes: "B to A",
  });
  const results = await Promise.all([forward, backward]);
  expect(results.map((r) => r.status)).toEqual([201, 201]);
  const sourceStock = await prisma.warehouseStock.findMany({ where: { warehouseId: f.source.id } });
  const destStock = await prisma.warehouseStock.findMany({ where: { warehouseId: f.destination.id } });
  expect(sourceStock.map((s) => s.quantity)).toEqual([100, 100]);
  expect(destStock.map((s) => s.quantity)).toEqual([100, 100]);
});

test("concurrent restocks preserve every increment without lost updates", async () => {
  const f = await fixture();
  const [r1, r2] = await Promise.all([
    request(app).post(`/api/businesses/${f.businessId}/stock/receive`).set("Cookie", f.owner.cookie).send({
      warehouseId: f.source.id, items: [{ productId: f.products[0].id, quantity: 15 }],
    }),
    request(app).post(`/api/businesses/${f.businessId}/stock/receive`).set("Cookie", f.owner.cookie).send({
      warehouseId: f.source.id, items: [{ productId: f.products[0].id, quantity: 25 }],
    }),
  ]);
  expect([r1.status, r2.status]).toEqual([201, 201]);
  const stock = await prisma.warehouseStock.findUnique({
    where: { warehouseId_productId: { warehouseId: f.source.id, productId: f.products[0].id } },
  });
  expect(stock.quantity).toBe(140);
});

test("blocks foreign warehouses and soft-deleted products in bulk transfers", async () => {
  const f = await fixture();
  const other = await createSuperAdminWithBusiness();
  const foreignWarehouse = await prisma.warehouse.create({ data: { businessId: other.business.id, name: "Other WH" } });
  const badDest = await request(app).post(`/api/businesses/${f.businessId}/stock/move-bulk`).set("Cookie", f.owner.cookie).send({
    fromWarehouseId: f.source.id, toWarehouseId: foreignWarehouse.id, items: [{ productId: f.products[0].id, quantity: 1 }],
  });
  expect(badDest.status).toBe(404);
  const badSrc = await request(app).post(`/api/businesses/${f.businessId}/stock/move-bulk`).set("Cookie", f.owner.cookie).send({
    fromWarehouseId: foreignWarehouse.id, toWarehouseId: f.destination.id, items: [{ productId: f.products[0].id, quantity: 1 }],
  });
  expect(badSrc.status).toBe(404);
  await prisma.product.update({ where: { id: f.products[0].id }, data: { deletedAt: new Date() } });
  const deletedProd = await transfer(f, [{ productId: f.products[0].id, quantity: 1 }]);
  expect(deletedProd.status).toBe(404);
});

test("product detail hides costPrice on both product and nested transactionItems for employees", async () => {
  const f = await fixture();
  await prisma.warehouse.update({ where: { id: f.source.id }, data: { isPrimary: true } });
  await prisma.product.update({ where: { id: f.products[0].id }, data: { costPrice: 6.5 } });
  const sale = await request(app).post(`/api/businesses/${f.businessId}/transactions`).set("Cookie", f.owner.cookie).send({
    paymentMethod: "CASH",
    items: [{ productId: f.products[0].id, quantitySold: 2, unitPrice: 10 }],
  });
  expect(sale.status).toBe(201);

  const employee = await addAndLoginTeamMember(f.owner.cookie, f.businessId);
  const empRes = await request(app).get(`/api/businesses/${f.businessId}/products/${f.products[0].id}`).set("Cookie", employee.cookie);
  expect(empRes.status).toBe(200);
  expect(empRes.body.data).not.toHaveProperty("costPrice");
  expect(empRes.body.data.transactionItems).toHaveLength(1);
  expect(empRes.body.data.transactionItems[0]).not.toHaveProperty("costPrice");

  const ownerRes = await request(app).get(`/api/businesses/${f.businessId}/products/${f.products[0].id}`).set("Cookie", f.owner.cookie);
  expect(ownerRes.status).toBe(200);
  expect(ownerRes.body.data.costPrice).toBe(6.5);
  expect(ownerRes.body.data.transactionItems[0].costPrice).toBe(6.5);
});

test("adjustment on a missing stock row and concurrent first receipt keep stock and movement history consistent", async () => {
  const f = await fixture();
  const product = f.products[0];
  // Destination warehouse has no WarehouseStock row for `product` yet.
  const lockWarehouse = (tx) => tx.$queryRaw`SELECT id FROM "Warehouse" WHERE id = ${f.destination.id} FOR UPDATE`;
  const [adjRes, recvRes] = await blockedRace(lockWarehouse, [
    () => request(app).post(`/api/businesses/${f.businessId}/stock/adjust`).set("Cookie", f.owner.cookie).send({
      warehouseId: f.destination.id, productId: product.id, actualQuantity: 5, reason: "MISCOUNTED",
    }),
    () => request(app).post(`/api/businesses/${f.businessId}/stock/receive`).set("Cookie", f.owner.cookie).send({
      warehouseId: f.destination.id, items: [{ productId: product.id, quantity: 10 }],
    }),
  ]);
  expect([adjRes.status, recvRes.status]).toEqual([201, 201]);

  const stock = await prisma.warehouseStock.findUnique({
    where: { warehouseId_productId: { warehouseId: f.destination.id, productId: product.id } },
  });
  const adjustment = adjRes.body.data;
  if (adjustment.previousQuantity === 0) {
    // Adjustment ran first (0 -> 5), then receipt added 10 -> 15.
    expect(adjustment.newQuantity).toBe(5);
    expect(stock.quantity).toBe(15);
  } else {
    // Receipt ran first (0 -> 10), then adjustment reconciled 10 -> 5.
    expect(adjustment.previousQuantity).toBe(10);
    expect(adjustment.newQuantity).toBe(5);
    expect(stock.quantity).toBe(5);
  }
});

test("stock adjustment and concurrent purchase order receipt serialize without deadlocking", async () => {
  const f = await fixture();
  const product = f.products[0];
  const supplier = await prisma.supplier.create({ data: { businessId: f.businessId, name: "Acme Foods", phone: "+233241234567", address: "Accra" } });
  const orderRes = await request(app).post(`/api/businesses/${f.businessId}/purchasing/orders`).set("Cookie", f.owner.cookie).send({
    supplierId: supplier.id,
    warehouseId: f.source.id,
    items: [{ productId: product.id, quantity: 20, unitCost: 7.5 }],
  });
  expect(orderRes.status).toBe(200);
  const placeRes = await request(app).post(`/api/businesses/${f.businessId}/purchasing/orders/${orderRes.body.data.id}/status`).set("Cookie", f.owner.cookie).send({ action: "ORDER", version: 0 });
  expect(placeRes.status).toBe(200);
  const order = placeRes.body.data;

  const lockStock = (tx) => tx.$queryRaw`
    SELECT id FROM "WarehouseStock" WHERE "warehouseId" = ${f.source.id} AND "productId" = ${product.id} FOR UPDATE
  `;
  const [adjRes, poRes] = await blockedRace(lockStock, [
    () => request(app).post(`/api/businesses/${f.businessId}/stock/adjust`).set("Cookie", f.owner.cookie).send({
      warehouseId: f.source.id, productId: product.id, actualQuantity: 85, reason: "MISCOUNTED",
    }),
    () => request(app).post(`/api/businesses/${f.businessId}/purchasing/orders/${order.id}/receive`).set("Cookie", f.owner.cookie).send({
      version: order.version,
      requestId: "11111111-1111-4111-8111-111111111111",
      items: [{ orderItemId: order.items[0].id, quantity: 20 }],
    }),
  ]);
  expect(adjRes.status).toBe(201);
  expect(poRes.status).toBe(200);

  const stock = await prisma.warehouseStock.findUnique({
    where: { warehouseId_productId: { warehouseId: f.source.id, productId: product.id } },
  });
  const updatedProduct = await prisma.product.findUnique({ where: { id: product.id } });
  expect(updatedProduct.costPrice).toBe(7.5);
  if (adjRes.body.data.previousQuantity === 100) {
    // Adjustment ran first (100 -> 85), then PO added 20 -> 105.
    expect(stock.quantity).toBe(105);
  } else {
    // PO ran first (100 -> 120), then adjustment reconciled 120 -> 85.
    expect(adjRes.body.data.previousQuantity).toBe(120);
    expect(stock.quantity).toBe(85);
  }
});

test("warehouse deletion and concurrent incoming transfer are mutually exclusive", async () => {
  const f = await fixture();
  await prisma.warehouse.update({ where: { id: f.source.id }, data: { isPrimary: true } });
  const lockDest = (tx) => tx.$queryRaw`SELECT id FROM "Warehouse" WHERE id = ${f.destination.id} FOR UPDATE`;
  const [delRes, moveRes] = await blockedRace(lockDest, [
    () => request(app).delete(`/api/businesses/${f.businessId}/warehouses/${f.destination.id}`).set("Cookie", f.owner.cookie),
    () => transfer(f, [{ productId: f.products[0].id, quantity: 10 }]),
  ]);

  const dest = await prisma.warehouse.findUnique({ where: { id: f.destination.id } });
  const destStock = await prisma.warehouseStock.findUnique({
    where: { warehouseId_productId: { warehouseId: f.destination.id, productId: f.products[0].id } },
  });

  if (delRes.status === 200) {
    expect(moveRes.status).toBe(404);
    expect(dest.deletedAt).not.toBeNull();
    expect(destStock).toBeNull();
  } else {
    expect(delRes.status).toBe(400);
    expect(moveRes.status).toBe(201);
    expect(dest.deletedAt).toBeNull();
    expect(destStock.quantity).toBe(10);
  }
});

test("warehouse deletion and concurrent purchase order receipt are mutually exclusive", async () => {
  const f = await fixture();
  await prisma.warehouse.update({ where: { id: f.source.id }, data: { isPrimary: true } });
  const supplier = await prisma.supplier.create({ data: { businessId: f.businessId, name: "Harbor Supply", phone: "+233241234568", address: "Kumasi" } });
  const orderRes = await request(app).post(`/api/businesses/${f.businessId}/purchasing/orders`).set("Cookie", f.owner.cookie).send({
    supplierId: supplier.id,
    warehouseId: f.destination.id,
    items: [{ productId: f.products[0].id, quantity: 12, unitCost: 5 }],
  });
  expect(orderRes.status).toBe(200);
  const placeRes = await request(app).post(`/api/businesses/${f.businessId}/purchasing/orders/${orderRes.body.data.id}/status`).set("Cookie", f.owner.cookie).send({ action: "ORDER", version: 0 });
  expect(placeRes.status).toBe(200);
  const order = placeRes.body.data;

  const lockDest = (tx) => tx.$queryRaw`SELECT id FROM "Warehouse" WHERE id = ${f.destination.id} FOR UPDATE`;
  const [delRes, poRes] = await blockedRace(lockDest, [
    () => request(app).delete(`/api/businesses/${f.businessId}/warehouses/${f.destination.id}`).set("Cookie", f.owner.cookie),
    () => request(app).post(`/api/businesses/${f.businessId}/purchasing/orders/${order.id}/receive`).set("Cookie", f.owner.cookie).send({
      version: order.version,
      requestId: "22222222-2222-4222-8222-222222222222",
      items: [{ orderItemId: order.items[0].id, quantity: 12 }],
    }),
  ]);

  const dest = await prisma.warehouse.findUnique({ where: { id: f.destination.id } });
  const destStock = await prisma.warehouseStock.findUnique({
    where: { warehouseId_productId: { warehouseId: f.destination.id, productId: f.products[0].id } },
  });

  if (delRes.status === 200) {
    expect(poRes.status).toBe(409);
    expect(dest.deletedAt).not.toBeNull();
    expect(destStock).toBeNull();
  } else {
    expect(delRes.status).toBe(400);
    expect(poRes.status).toBe(200);
    expect(dest.deletedAt).toBeNull();
    expect(destStock.quantity).toBe(12);
  }
});
