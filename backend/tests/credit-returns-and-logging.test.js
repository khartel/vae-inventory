const { PassThrough } = require("stream");
const pino = require("pino");
const prisma = require("../src/utils/prisma");
const logger = require("../src/utils/logger");
const { createReturn } = require("../src/services/transaction.service");
const { app, request, createSuperAdminWithBusiness } = require("./helpers");

describe("Credit returns, duplicate-item returns, and log redaction", () => {
  test("redacts cookies, bearer tokens, set-cookie, and x-master-key in Pino logs", () => {
    const chunks = [];
    const stream = new PassThrough();
    stream.on("data", (chunk) => chunks.push(chunk.toString()));

    const testLogger = pino(
      {
        level: "info",
        redact: { paths: logger.REDACT_PATHS, censor: "[Redacted]" },
      },
      stream
    );

    testLogger.info(
      {
        req: {
          headers: {
            cookie: "token=super-secret-jwt-value",
            authorization: "Bearer super-secret-bearer",
            "x-master-key": "super-secret-master-key",
            "user-agent": "jest-test",
          },
        },
        res: {
          headers: {
            "set-cookie": "token=newly-issued-secret-jwt; HttpOnly",
            "content-type": "application/json",
          },
        },
      },
      "request completed"
    );

    const output = chunks.join("");
    expect(output).not.toContain("super-secret-jwt-value");
    expect(output).not.toContain("super-secret-bearer");
    expect(output).not.toContain("super-secret-master-key");
    expect(output).not.toContain("newly-issued-secret-jwt");

    const parsed = JSON.parse(output.trim());
    expect(parsed.req.headers.cookie).toBe("[Redacted]");
    expect(parsed.req.headers.authorization).toBe("[Redacted]");
    expect(parsed.req.headers["x-master-key"]).toBe("[Redacted]");
    expect(parsed.req.headers["user-agent"]).toBe("jest-test");
    expect(parsed.res.headers["set-cookie"]).toBe("[Redacted]");
    expect(parsed.res.headers["content-type"]).toBe("application/json");
  });

  test("CREDIT_BALANCE returns reduce customer outstanding credit and allow exact remaining settlement", async () => {
    const owner = await createSuperAdminWithBusiness();
    const businessId = owner.business.id;

    const whRes = await request(app)
      .post(`/api/businesses/${businessId}/warehouses`)
      .set("Cookie", owner.cookie)
      .send({ name: "Main", location: "Lagos", isPrimary: true });
    expect(whRes.status).toBe(201);

    const prodRes = await request(app)
      .post(`/api/businesses/${businessId}/products`)
      .set("Cookie", owner.cookie)
      .send({ name: "Rice Bag", unit: "pcs", price: 20 });
    expect(prodRes.status).toBe(201);

    await request(app)
      .post(`/api/businesses/${businessId}/stock/receive`)
      .set("Cookie", owner.cookie)
      .send({
        warehouseId: whRes.body.data.id,
        items: [{ productId: prodRes.body.data.id, quantity: 10 }],
      });

    const custRes = await request(app)
      .post(`/api/businesses/${businessId}/customers`)
      .set("Cookie", owner.cookie)
      .send({
        name: "Adaeze Credit",
        phone: "+2348012345678",
        address: "12 Broad Street, Lagos",
      });
    expect(custRes.status).toBe(201);
    const customerId = custRes.body.data.id;

    // Credit sale of 5 x 20 = 100
    const saleRes = await request(app)
      .post(`/api/businesses/${businessId}/transactions`)
      .set("Cookie", owner.cookie)
      .send({
        paymentMethod: "CREDIT",
        customerId,
        items: [{ productId: prodRes.body.data.id, quantitySold: 5, unitPrice: 20 }],
      });
    expect(saleRes.status).toBe(201);
    const txId = saleRes.body.data.id;
    const itemId = saleRes.body.data.items[0].id;

    // Return 2 x 20 = 40 against CREDIT_BALANCE -> remaining balance should be 60
    const retRes = await request(app)
      .post(`/api/businesses/${businessId}/transactions/${txId}/returns`)
      .set("Cookie", owner.cookie)
      .send({
        refundMethod: "CREDIT_BALANCE",
        reason: "Damaged bags",
        items: [{ transactionItemId: itemId, quantityReturned: 2 }],
      });
    expect(retRes.status).toBe(201);
    expect(retRes.body.data.balanceDue).toBe(60);
    expect(retRes.body.data.amountPaid).toBe(0);
    expect(retRes.body.data.paidAt).toBeNull();

    // Customers directory and detail must both agree on 60 owed (and 0 paid)
    const listCustRes = await request(app)
      .get(`/api/businesses/${businessId}/customers`)
      .set("Cookie", owner.cookie);
    expect(listCustRes.status).toBe(200);
    expect(listCustRes.body.data[0].outstandingCredit).toBe(60);

    const detailCustRes = await request(app)
      .get(`/api/businesses/${businessId}/customers/${customerId}`)
      .set("Cookie", owner.cookie);
    expect(detailCustRes.status).toBe(200);
    expect(detailCustRes.body.data.outstandingCredit).toBe(60);
    expect(detailCustRes.body.data.transactions[0].amountPaid).toBe(0);
    expect(detailCustRes.body.data.transactions[0].balanceDue).toBe(60);

    // Paying more than the 60 remaining balance must be rejected
    const overpayRes = await request(app)
      .post(`/api/businesses/${businessId}/transactions/${txId}/payments`)
      .set("Cookie", owner.cookie)
      .send({ amount: 70 });
    expect(overpayRes.status).toBe(400);

    // Paying the exact remaining 60 must settle the sale (paidAt set)
    const settleRes = await request(app)
      .post(`/api/businesses/${businessId}/transactions/${txId}/payments`)
      .set("Cookie", owner.cookie)
      .send({ amount: 60 });
    expect(settleRes.status).toBe(201);
    expect(settleRes.body.data.amountPaid).toBe(60);
    expect(settleRes.body.data.balanceDue).toBe(0);
    expect(settleRes.body.data.paidAt).not.toBeNull();

    // Customer outstanding credit must now be 0
    const settledCustRes = await request(app)
      .get(`/api/businesses/${businessId}/customers/${customerId}`)
      .set("Cookie", owner.cookie);
    expect(settledCustRes.status).toBe(200);
    expect(settledCustRes.body.data.outstandingCredit).toBe(0);
    expect(settledCustRes.body.data.transactions[0].amountPaid).toBe(60);
    expect(settledCustRes.body.data.transactions[0].balanceDue).toBe(0);
  });

  test("rejects duplicate transactionItemId entries in createReturn at both API and service layers", async () => {
    const owner = await createSuperAdminWithBusiness();
    const businessId = owner.business.id;

    const whRes = await request(app)
      .post(`/api/businesses/${businessId}/warehouses`)
      .set("Cookie", owner.cookie)
      .send({ name: "Main", location: "Lagos", isPrimary: true });
    const prodRes = await request(app)
      .post(`/api/businesses/${businessId}/products`)
      .set("Cookie", owner.cookie)
      .send({ name: "Cooking Oil", unit: "pcs", price: 50 });

    await request(app)
      .post(`/api/businesses/${businessId}/stock/receive`)
      .set("Cookie", owner.cookie)
      .send({
        warehouseId: whRes.body.data.id,
        items: [{ productId: prodRes.body.data.id, quantity: 5 }],
      });

    // Sell 1 unit -> remaining stock is 4
    const saleRes = await request(app)
      .post(`/api/businesses/${businessId}/transactions`)
      .set("Cookie", owner.cookie)
      .send({
        paymentMethod: "CASH",
        items: [{ productId: prodRes.body.data.id, quantitySold: 1, unitPrice: 50 }],
      });
    expect(saleRes.status).toBe(201);
    const txId = saleRes.body.data.id;
    const itemId = saleRes.body.data.items[0].id;

    // Duplicate item in HTTP request -> 400 validation error
    const dupHttpRes = await request(app)
      .post(`/api/businesses/${businessId}/transactions/${txId}/returns`)
      .set("Cookie", owner.cookie)
      .send({
        refundMethod: "CASH",
        items: [
          { transactionItemId: itemId, quantityReturned: 1 },
          { transactionItemId: itemId, quantityReturned: 1 },
        ],
      });
    expect(dupHttpRes.status).toBe(400);

    // Service-layer defense in depth
    await expect(
      createReturn(txId, businessId, {
        refundMethod: "CASH",
        processedById: owner.user.id,
        items: [
          { transactionItemId: itemId, quantityReturned: 1 },
          { transactionItemId: itemId, quantityReturned: 1 },
        ],
      })
    ).rejects.toThrow("Each item can only appear once in a return");

    // Stock must remain 4 (not double-restocked)
    const stock = await prisma.warehouseStock.findUnique({
      where: {
        warehouseId_productId: {
          warehouseId: whRes.body.data.id,
          productId: prodRes.body.data.id,
        },
      },
    });
    expect(stock.quantity).toBe(4);
  });
});
