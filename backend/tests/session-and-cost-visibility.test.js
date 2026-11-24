const prisma = require("../src/utils/prisma");
const { generateToken, generateShortLivedToken, verifyToken } = require("../src/utils/jwt.utils");
const { app, request, createSuperAdminWithBusiness, addAndLoginTeamMember } = require("./helpers");

describe("Session token boundary", () => {
  test("enabled 2FA survives setup attempts until password-protected disable succeeds", async () => {
    const owner = await createSuperAdminWithBusiness();
    const initial = await request(app).post("/api/auth/2fa/setup").set("Cookie", owner.cookie);
    expect(initial.status).toBe(200);
    const secret = initial.body.data.secret;
    await prisma.user.update({ where: { id: owner.user.id }, data: { twoFactorEnabled: true } });
    const refused = await request(app).post("/api/auth/2fa/setup").set("Cookie", owner.cookie);
    expect(refused.status).toBe(409);
    let user = await prisma.user.findUnique({ where: { id: owner.user.id } });
    expect(user.twoFactorEnabled).toBe(true);
    expect(user.twoFactorSecret).toBe(secret);
    expect((await request(app).post("/api/auth/2fa/disable").set("Cookie", owner.cookie).send({ password: "incorrect-password" })).status).toBe(401);
    user = await prisma.user.findUnique({ where: { id: owner.user.id } });
    expect(user.twoFactorEnabled).toBe(true);
    expect(user.twoFactorSecret).toBe(secret);
    expect((await request(app).post("/api/auth/2fa/disable").set("Cookie", owner.cookie).send({ password: "password123" })).status).toBe(200);
    const restarted = await request(app).post("/api/auth/2fa/setup").set("Cookie", owner.cookie);
    expect(restarted.status).toBe(200);
    expect(restarted.body.data.secret).not.toBe(secret);
  });

  test.each(["2fa-pending", "password-reset"])("rejects %s tokens in cookies and bearer headers", async (purpose) => {
    const owner = await createSuperAdminWithBusiness();
    expect((await prisma.user.findUnique({ where: { id: owner.user.id } })).tokenVersion).toBe(0);
    let token;
    if (purpose === "2fa-pending") {
      await prisma.user.update({ where: { id: owner.user.id }, data: { twoFactorEnabled: true, twoFactorSecret: "JBSWY3DPEHPK3PXP" } });
      const login = await request(app).post("/api/auth/login").send({ username: owner.user.username, password: "password123" });
      expect(login.status).toBe(200);
      expect(login.body.data.requires2FA).toBe(true);
      expect(login.headers["set-cookie"]).toBeUndefined();
      token = login.body.data.tempToken;
    } else {
      token = generateShortLivedToken({ id: owner.user.id, purpose }, "30m");
    }
    for (const headers of [{ Authorization: `Bearer ${token}` }, { Cookie: `token=${token}` }]) {
      expect((await request(app).get("/api/auth/me").set(headers)).status).toBe(401);
      expect((await request(app).get(`/api/businesses/${owner.business.id}/products`).set(headers)).status).toBe(401);
      expect((await request(app).post(`/api/businesses/${owner.business.id}/warehouses`).set(headers).send({ name: "Forbidden" })).status).toBe(401);
    }
    expect(await prisma.warehouse.count({ where: { businessId: owner.business.id } })).toBe(0);
  });

  test("tags sessions, preserves legacy sessions, and still enforces revocation", async () => {
    const owner = await createSuperAdminWithBusiness();
    const session = decodeURIComponent(owner.cookie[0].split(";")[0].slice("token=".length));
    expect(verifyToken(session).tokenType).toBe("session");
    const legacy = generateToken({ id: owner.user.id, role: "SUPERADMIN", tokenVersion: 0 });
    for (const token of [session, legacy]) {
      expect((await request(app).get("/api/auth/me").set("Authorization", `Bearer ${token}`)).status).toBe(200);
      expect((await request(app).get(`/api/businesses/${owner.business.id}/products`).set("Authorization", `Bearer ${token}`)).status).toBe(200);
    }
    await prisma.user.update({ where: { id: owner.user.id }, data: { tokenVersion: { increment: 1 } } });
    for (const token of [session, legacy]) {
      expect((await request(app).get("/api/auth/me").set("Authorization", `Bearer ${token}`)).status).toBe(401);
    }
  });

  test("rejects unknown token types and purpose claims even on an explicitly tagged session", async () => {
    const owner = await createSuperAdminWithBusiness();
    for (const claims of [{ tokenType: "other" }, { tokenType: "session", purpose: "password-reset" }, { purpose: "unknown" }]) {
      const token = generateToken({ id: owner.user.id, role: "SUPERADMIN", tokenVersion: 0, ...claims });
      expect((await request(app).get("/api/auth/me").set("Authorization", `Bearer ${token}`)).status).toBe(401);
    }
  });
});

describe("Transaction cost visibility", () => {
  test.each(["EMPLOYEE", "ADMIN", "SUPERADMIN"])("uses the business role for %s across sale, payment, history and customer responses", async (role) => {
    const owner = await createSuperAdminWithBusiness();
    const businessId = owner.business.id;
    let cookie = owner.cookie;
    if (role !== "SUPERADMIN") {
      // The employee deliberately has a global ADMIN token: that must not grant
      // access to costs in a business where their membership is EMPLOYEE.
      const staff = await addAndLoginTeamMember(owner.cookie, businessId, "ADMIN");
      await prisma.businessUser.updateMany({ where: { businessId, userId: staff.user.id }, data: { role } });
      cookie = staff.cookie;
    }
    const warehouse = await prisma.warehouse.create({ data: { businessId, name: "Main", isPrimary: true } });
    const product = await prisma.product.create({ data: { businessId, name: "Rice", unit: "pcs", price: 50, costPrice: 12 } });
    await prisma.warehouseStock.create({ data: { warehouseId: warehouse.id, productId: product.id, quantity: 10 } });
    const customer = await prisma.customer.create({ data: { businessId, name: "Known customer", phone: "+233241234567", address: "Accra" } });
    const base = `/api/businesses/${businessId}`;
    const visible = role !== "EMPLOYEE";
    const expectCosts = (transaction, includeCost = visible) => {
      expect(transaction.items).toHaveLength(1);
      if (includeCost) expect(transaction.items[0].costPrice).toBe(12);
      else expect(transaction.items[0]).not.toHaveProperty("costPrice");
    };

    const sale = await request(app).post(`${base}/transactions`).set("Cookie", cookie).send({
      paymentMethod: "CREDIT", customerId: customer.id,
      items: [{ productId: product.id, quantitySold: 2, unitPrice: 50 }],
    });
    expect(sale.status).toBe(201);
    expectCosts(sale.body.data);
    const id = sale.body.data.id;
    const payment = await request(app).post(`${base}/transactions/${id}/payments`).set("Cookie", cookie).send({ amount: 20 });
    expect(payment.status).toBe(201);
    expectCosts(payment.body.data);

    const returnBody = { refundMethod: "CREDIT_BALANCE", items: [{ transactionItemId: sale.body.data.items[0].id, quantityReturned: 1 }] };
    if (!visible) {
      expect((await request(app).post(`${base}/transactions/${id}/returns`).set("Cookie", cookie).send(returnBody)).status).toBe(403);
      expect((await request(app).delete(`${base}/transactions/${id}/payments/${payment.body.data.payments[0].id}`).set("Cookie", cookie)).status).toBe(403);
    }
    const returned = await request(app).post(`${base}/transactions/${id}/returns`).set("Cookie", visible ? cookie : owner.cookie).send(returnBody);
    expect(returned.status).toBe(201);
    expectCosts(returned.body.data, true);
    const undone = await request(app).delete(`${base}/transactions/${id}/payments/${payment.body.data.payments[0].id}`).set("Cookie", visible ? cookie : owner.cookie);
    expect(undone.status).toBe(200);
    expectCosts(undone.body.data, true);

    const list = await request(app).get(`${base}/transactions`).set("Cookie", cookie);
    expect(list.status).toBe(200);
    expectCosts(list.body.data.transactions[0]);
    const detail = await request(app).get(`${base}/transactions/${id}`).set("Cookie", cookie);
    expect(detail.status).toBe(200);
    expectCosts(detail.body.data);
    const customerDetail = await request(app).get(`${base}/customers/${customer.id}`).set("Cookie", cookie);
    expect(customerDetail.status).toBe(200);
    expectCosts(customerDetail.body.data.transactions[0]);
    expect((await prisma.transactionItem.findFirst({ where: { transactionId: id } })).costPrice).toBe(12);
  });
});
