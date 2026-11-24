const prisma = require("../src/utils/prisma");
const { app, request, createSuperAdminWithBusiness } = require("./helpers");

// Hold the parent row while both requests reach a database lock. This forces
// overlap without timing-dependent sleeps or mocks of transaction semantics.
async function blockedRace(lockRow, operations, beforeRelease) {
  let release;
  let ready;
  let lockedTx;
  const gate = new Promise((resolve) => { release = resolve; });
  const started = new Promise((resolve) => { ready = resolve; });
  const blocker = prisma.$transaction(async (tx) => {
    await lockRow(tx);
    lockedTx = tx;
    const [{ pid }] = await tx.$queryRaw`SELECT pg_backend_pid() AS pid`;
    ready(pid);
    await gate;
  }, { timeout: 10000 });
  // Also propagate an initial lock/connection failure instead of hanging.
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
    if (beforeRelease) await beforeRelease(lockedTx);
  } finally {
    release();
    // Drain all requests even after a failed assertion before TRUNCATE cleanup.
    await Promise.allSettled([blocker, ...pending]);
    await blocker;
  }
  return Promise.all(pending);
}

async function saleFixture() {
  const owner = await createSuperAdminWithBusiness();
  const businessId = owner.business.id;
  const warehouse = await prisma.warehouse.create({ data: { businessId, name: "Main", isPrimary: true } });
  const product = await prisma.product.create({ data: { businessId, name: "Rice", unit: "pcs", price: 20, costPrice: 8 } });
  const customer = await prisma.customer.create({ data: { businessId, name: "Customer", phone: "+233241234567", address: "Accra" } });
  const sale = await prisma.transaction.create({ data: {
    businessId, warehouseId: warehouse.id, performedById: owner.user.id, customerId: customer.id,
    paymentMethod: "CREDIT", totalAmount: 100,
    items: { create: [{ productId: product.id, quantitySold: 5, unitPrice: 20, subtotal: 100, costPrice: 8 }] },
  }, include: { items: true } });
  await prisma.warehouseStock.create({ data: { warehouseId: warehouse.id, productId: product.id, quantity: 5 } });
  const base = `/api/businesses/${businessId}/transactions/${sale.id}`;
  const pay = (amount) => request(app).post(`${base}/payments`).set("Cookie", owner.cookie).send({ amount });
  const undo = (id) => request(app).delete(`${base}/payments/${id}`).set("Cookie", owner.cookie);
  const returns = () => request(app).post(`${base}/returns`).set("Cookie", owner.cookie).send({
    refundMethod: "CREDIT_BALANCE", items: [{ transactionItemId: sale.items[0].id, quantityReturned: 5 }],
  });
  const lockRow = (tx) => tx.$queryRaw`SELECT id FROM "Transaction" WHERE id = ${sale.id} FOR UPDATE`;
  const read = () => request(app).get(base).set("Cookie", owner.cookie);
  return { owner, businessId, warehouse, product, sale, pay, undo, returns, lockRow, read };
}

describe("Sale ledger serialization", () => {
  test("two full payments cannot both be accepted", async () => {
    const f = await saleFixture();
    const responses = await blockedRace(f.lockRow, [() => f.pay(100), () => f.pay(100)]);
    expect(responses.map((r) => r.status).sort()).toEqual([201, 400]);
    expect(await prisma.creditPayment.count({ where: { transactionId: f.sale.id } })).toBe(1);
    const state = (await f.read()).body.data;
    expect(state.amountPaid).toBe(100);
    expect(state.balanceDue).toBe(0);
    expect(state.paidAt).not.toBeNull();
  });

  test("two full returns cannot duplicate refunds or restock", async () => {
    const f = await saleFixture();
    const responses = await blockedRace(f.lockRow, [f.returns, f.returns]);
    expect(responses.map((r) => r.status).sort()).toEqual([201, 400]);
    expect(await prisma.return.count({ where: { transactionId: f.sale.id } })).toBe(1);
    expect((await prisma.warehouseStock.findFirst({ where: { productId: f.product.id } })).quantity).toBe(10);
    expect((await f.read()).body.data.balanceDue).toBe(0);
  });

  test("a full payment racing a full balance-reducing return cannot over-settle the sale", async () => {
    const f = await saleFixture();
    const responses = await blockedRace(f.lockRow, [() => f.pay(100), f.returns]);
    expect(responses.map((r) => r.status).sort()).toEqual([201, 400]);
    const state = (await f.read()).body.data;
    expect(state.balanceDue).toBe(0);
    expect(state.amountPaid + state.returns.reduce((sum, entry) => sum + entry.refundAmount, 0)).toBe(100);
  });

  test("concurrent undo of the same payment is one correction and one 404", async () => {
    const f = await saleFixture();
    const payment = await f.pay(100);
    expect(payment.status).toBe(201);
    const id = payment.body.data.payments[0].id;
    const responses = await blockedRace(f.lockRow, [() => f.undo(id), () => f.undo(id)]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 404]);
    const state = (await f.read()).body.data;
    expect(state.balanceDue).toBe(100);
    expect(state.paidAt).toBeNull();
    expect(await prisma.auditLog.count({ where: { entityId: f.sale.id, action: "credit_payment.undone" } })).toBe(1);
  });

  test("payment racing an undo recomputes settlement from the locked ledger", async () => {
    const f = await saleFixture();
    const payment = await f.pay(40);
    const id = payment.body.data.payments[0].id;
    const responses = await blockedRace(f.lockRow, [() => f.pay(60), () => f.undo(id)]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 201]);
    const state = (await f.read()).body.data;
    expect(state.amountPaid).toBe(60);
    expect(state.balanceDue).toBe(40);
    expect(state.paidAt).toBeNull();
  });

  test("locks remain scoped to the requested business", async () => {
    const f = await saleFixture();
    const other = await prisma.business.create({ data: {
      ownerId: f.owner.user.id, name: "Other business", phone: "08011111111", country: "Nigeria", location: "Lagos", currency: "NGN",
    } });
    const base = `/api/businesses/${other.id}/transactions/${f.sale.id}`;
    const payment = await f.pay(20);
    for (const operation of [
      request(app).post(`${base}/payments`).send({ amount: 10 }),
      request(app).delete(`${base}/payments/${payment.body.data.payments[0].id}`),
      request(app).post(`${base}/returns`).send({ refundMethod: "CASH", items: [{ transactionItemId: f.sale.items[0].id, quantityReturned: 1 }] }),
    ]) expect((await operation.set("Cookie", f.owner.cookie)).status).toBe(404);
    expect((await f.read()).body.data.amountPaid).toBe(20);
  });
});

describe("Primary warehouse serialization", () => {
  test("deletion waiting on a stock writer permits that writer's business audit FK check", async () => {
    const owner = await createSuperAdminWithBusiness();
    const businessId = owner.business.id;
    await prisma.warehouse.create({ data: { businessId, name: "Main", isPrimary: true } });
    const target = await prisma.warehouse.create({ data: { businessId, name: "Secondary" } });
    const product = await prisma.product.create({ data: { businessId, name: "Stocked product", unit: "pcs" } });
    const responses = await blockedRace(
      (tx) => tx.$queryRaw`SELECT id FROM "Warehouse" WHERE id = ${target.id} FOR NO KEY UPDATE`,
      [() => request(app).delete(`/api/businesses/${businessId}/warehouses/${target.id}`).set("Cookie", owner.cookie)],
      async (tx) => {
        // Model the end of an adjustment: Warehouse is already locked, stock
        // changes, then its audit inserts a FK pointing at the Business row.
        await tx.warehouseStock.create({ data: { warehouseId: target.id, productId: product.id, quantity: 3 } });
        await tx.auditLog.create({ data: {
          businessId, actorId: owner.user.id, actorName: "Test Owner",
          action: "stock.adjusted", entityType: "StockMovement",
        } });
      }
    );
    expect(responses[0].status).toBe(400);
    expect((await prisma.warehouse.findUnique({ where: { id: target.id } })).deletedAt).toBeNull();
    expect((await prisma.warehouseStock.findFirst({ where: { warehouseId: target.id } })).quantity).toBe(3);
  });

  test("concurrent first warehouses create exactly one primary", async () => {
    const owner = await createSuperAdminWithBusiness();
    const businessId = owner.business.id;
    const base = `/api/businesses/${businessId}/warehouses`;
    const responses = await blockedRace(
      (tx) => tx.$queryRaw`SELECT id FROM "Business" WHERE id = ${businessId} FOR UPDATE`,
      ["First", "Second"].map((name) => () => request(app).post(base).set("Cookie", owner.cookie).send({ name }))
    );
    expect(responses.map((r) => r.status)).toEqual([201, 201]);
    expect(await prisma.warehouse.count({ where: { businessId, deletedAt: null, isPrimary: true } })).toBe(1);
  });

  test("a primary creation racing promotion leaves exactly one primary", async () => {
    const owner = await createSuperAdminWithBusiness();
    const businessId = owner.business.id;
    const target = await prisma.warehouse.create({ data: { businessId, name: "Existing", isPrimary: true } });
    const base = `/api/businesses/${businessId}/warehouses`;
    const responses = await blockedRace(
      (tx) => tx.$queryRaw`SELECT id FROM "Business" WHERE id = ${businessId} FOR UPDATE`,
      [
        () => request(app).post(base).set("Cookie", owner.cookie).send({ name: "New primary", isPrimary: true }),
        () => request(app).patch(`${base}/${target.id}/primary`).set("Cookie", owner.cookie),
      ]
    );
    expect(responses.map((r) => r.status).sort()).toEqual([200, 201]);
    expect(await prisma.warehouse.count({ where: { businessId, deletedAt: null, isPrimary: true } })).toBe(1);
  });

  test("deletion racing promotion cannot delete the current primary", async () => {
    const owner = await createSuperAdminWithBusiness();
    const businessId = owner.business.id;
    await prisma.warehouse.create({ data: { businessId, name: "Main", isPrimary: true } });
    const target = await prisma.warehouse.create({ data: { businessId, name: "Secondary" } });
    const base = `/api/businesses/${businessId}/warehouses/${target.id}`;
    const responses = await blockedRace(
      (tx) => tx.$queryRaw`SELECT id FROM "Business" WHERE id = ${businessId} FOR UPDATE`,
      [
        () => request(app).patch(`${base}/primary`).set("Cookie", owner.cookie),
        () => request(app).delete(base).set("Cookie", owner.cookie),
      ]
    );
    expect(responses.filter((r) => r.status === 200)).toHaveLength(1);
    expect(responses.every((r) => [200, 400, 404].includes(r.status))).toBe(true);
    expect(await prisma.warehouse.count({ where: { businessId, deletedAt: null, isPrimary: true } })).toBe(1);
    expect(await prisma.warehouse.count({ where: { businessId, deletedAt: { not: null }, isPrimary: true } })).toBe(0);
  });
});
