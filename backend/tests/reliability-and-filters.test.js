const prisma = require("../src/utils/prisma");
const { getTransactionSummary } = require("../src/services/transaction.service");
const { getPrimaryClientUrl, welcomeEmailHtml } = require("../src/utils/email.utils");
const { parseCalendarDate } = require("../src/utils/parseDate");
const { app, request, createSuperAdminWithBusiness } = require("./helpers");

describe("Soft-delete filtering, dates, email links, product clearing, and proxy setup", () => {
  test("excludes soft-deleted products and warehouses from stock alerts, warehouses, and business counts", async () => {
    const owner = await createSuperAdminWithBusiness();
    const businessId = owner.business.id;

    const whPrimary = await request(app)
      .post(`/api/businesses/${businessId}/warehouses`)
      .set("Cookie", owner.cookie)
      .send({ name: "Primary WH", location: "Lagos", isPrimary: true });
    const whSecondary = await request(app)
      .post(`/api/businesses/${businessId}/warehouses`)
      .set("Cookie", owner.cookie)
      .send({ name: "Secondary WH", location: "Lagos" });

    const activeProd = await request(app)
      .post(`/api/businesses/${businessId}/products`)
      .set("Cookie", owner.cookie)
      .send({ name: "Active Soap", unit: "pcs", price: 10 });
    const deletedProd = await request(app)
      .post(`/api/businesses/${businessId}/products`)
      .set("Cookie", owner.cookie)
      .send({ name: "Discontinued Soap", unit: "pcs", price: 10 });

    // Receive low stock (3 pcs <= default 10) for both products into Primary WH
    await request(app)
      .post(`/api/businesses/${businessId}/stock/receive`)
      .set("Cookie", owner.cookie)
      .send({
        warehouseId: whPrimary.body.data.id,
        items: [
          { productId: activeProd.body.data.id, quantity: 3 },
          { productId: deletedProd.body.data.id, quantity: 2 },
        ],
      });

    // Soft-delete one product and the empty secondary warehouse
    await request(app)
      .delete(`/api/businesses/${businessId}/products/${deletedProd.body.data.id}`)
      .set("Cookie", owner.cookie);
    await request(app)
      .delete(`/api/businesses/${businessId}/warehouses/${whSecondary.body.data.id}`)
      .set("Cookie", owner.cookie);

    // Stock alerts must only report active products in active warehouses
    const alertsRes = await request(app)
      .get(`/api/businesses/${businessId}/reports/stock`)
      .set("Cookie", owner.cookie);
    expect(alertsRes.status).toBe(200);
    expect(alertsRes.body.data.summary.totalItems).toBe(1);
    expect(alertsRes.body.data.lowStock).toHaveLength(1);
    expect(alertsRes.body.data.lowStock[0].product.id).toBe(activeProd.body.data.id);

    // Warehouses list and detail must omit soft-deleted products from stock and _count.stock
    const whListRes = await request(app)
      .get(`/api/businesses/${businessId}/warehouses`)
      .set("Cookie", owner.cookie);
    expect(whListRes.status).toBe(200);
    expect(whListRes.body.data).toHaveLength(1);
    expect(whListRes.body.data[0].stock).toHaveLength(1);
    expect(whListRes.body.data[0]._count.stock).toBe(1);

    const whDetailRes = await request(app)
      .get(`/api/businesses/${businessId}/warehouses/${whPrimary.body.data.id}`)
      .set("Cookie", owner.cookie);
    expect(whDetailRes.status).toBe(200);
    expect(whDetailRes.body.data.stock).toHaveLength(1);
    expect(whDetailRes.body.data._count.stock).toBe(1);

    // Business counts must exclude soft-deleted products and warehouses
    const bizRes = await request(app)
      .get(`/api/businesses/${businessId}`)
      .set("Cookie", owner.cookie);
    expect(bizRes.status).toBe(200);
    expect(bizRes.body.data._count.products).toBe(1);
    expect(bizRes.body.data._count.warehouses).toBe(1);
    expect(bizRes.body.data.warehouses).toHaveLength(1);
  });

  test("getTransactionSummary counts current-week sales correctly on Sunday", async () => {
    const owner = await createSuperAdminWithBusiness();
    const businessId = owner.business.id;

    const wh = await request(app)
      .post(`/api/businesses/${businessId}/warehouses`)
      .set("Cookie", owner.cookie)
      .send({ name: "Main", location: "Lagos", isPrimary: true });
    const prod = await request(app)
      .post(`/api/businesses/${businessId}/products`)
      .set("Cookie", owner.cookie)
      .send({ name: "Flour", unit: "kg", price: 25 });

    // Seed a Wednesday transaction in the week of Mon 2026-11-16 .. Sun 2026-11-22
    const wednesday = new Date(2026, 10, 18, 12, 0, 0);
    await prisma.transaction.create({
      data: {
        businessId,
        warehouseId: wh.body.data.id,
        performedById: owner.user.id,
        paymentMethod: "CASH",
        totalAmount: 125,
        customerName: "Casual Customer",
        createdAt: wednesday,
        items: {
          create: [
            {
              productId: prod.body.data.id,
              quantitySold: 5,
              unitPrice: 25,
              subtotal: 125,
            },
          ],
        },
      },
    });

    // Evaluate summary on Sunday 2026-11-22 (getDay() === 0)
    const sunday = new Date(2026, 10, 22, 15, 0, 0);
    const summary = await getTransactionSummary(businessId, sunday);
    expect(summary.weekly.totalAmount).toBe(125);
    expect(summary.weekly.transactionCount).toBe(1);
  });

  test("handles multi-origin CLIENT_URL, escapes welcome HTML, and parses YYYY-MM-DD as local calendar date", () => {
    const original = process.env.CLIENT_URL;
    try {
      process.env.CLIENT_URL = " https://app.example.com/ , https://staging.example.com ";
      expect(getPrimaryClientUrl()).toBe("https://app.example.com");

      const html = welcomeEmailHtml('<b>Jane & "Bob"</b>');
      expect(html).toContain("https://app.example.com/login");
      expect(html).not.toContain("staging.example.com");
      expect(html).toContain("&lt;b&gt;Jane &amp; &quot;Bob&quot;&lt;/b&gt;");
    } finally {
      process.env.CLIENT_URL = original;
    }

    const parsed = parseCalendarDate("2026-11-12");
    expect(parsed.getFullYear()).toBe(2026);
    expect(parsed.getMonth()).toBe(10);
    expect(parsed.getDate()).toBe(12);
  });

  test("supports clearing shortCode and costPrice to null, returns 404 on foreign business update, and enables trust proxy", async () => {
    expect(app.get("trust proxy")).toBe(1);

    const ownerA = await createSuperAdminWithBusiness();
    const ownerB = await createSuperAdminWithBusiness();

    // Foreign business update returns 404 (not 500 from bare Error)
    const foreignUpdate = await request(app)
      .patch(`/api/businesses/${ownerA.business.id}`)
      .set("Cookie", ownerB.cookie)
      .send({ name: "Hijacked" });
    expect(foreignUpdate.status).toBe(404);

    // Create product with shortCode and costPrice, then clear both
    const created = await request(app)
      .post(`/api/businesses/${ownerA.business.id}/products`)
      .set("Cookie", ownerA.cookie)
      .send({ name: "Sugar", unit: "kg", price: 30, costPrice: 18, shortCode: "SUG1" });
    expect(created.status).toBe(201);
    expect(created.body.data.shortCode).toBe("SUG1");
    expect(created.body.data.costPrice).toBe(18);

    const cleared = await request(app)
      .patch(`/api/businesses/${ownerA.business.id}/products/${created.body.data.id}`)
      .set("Cookie", ownerA.cookie)
      .send({ shortCode: "", costPrice: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.shortCode).toBeNull();
    expect(cleared.body.data.costPrice).toBeNull();
  });
});
