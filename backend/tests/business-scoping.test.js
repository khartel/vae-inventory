const prisma = require("../src/utils/prisma");
const {
  app,
  request,
  createSuperAdminWithBusiness,
  addAndLoginTeamMember,
} = require("./helpers");

/**
 * Regression tests for the cross-business IDOR fix.
 * Before the fix, `belongsToBusiness` was defined but never wired into any
 * nested router, so any authenticated user could read/write another
 * business's data just by putting its id in the URL. These tests fail loudly
 * if that middleware is ever removed or a new nested router forgets it.
 */
describe("Cross-business access control (IDOR regression)", () => {
  test("a SuperAdmin cannot access a business they do not own", async () => {
    const ownerA = await createSuperAdminWithBusiness();
    const ownerB = await createSuperAdminWithBusiness();

    const res = await request(app)
      .get(`/api/businesses/${ownerA.business.id}/warehouses`)
      .set("Cookie", ownerB.cookie);

    expect(res.status).toBe(403);
  });

  test("an employee of business A cannot read business B's warehouses, team, products, transactions or reports", async () => {
    const ownerA = await createSuperAdminWithBusiness();
    const ownerB = await createSuperAdminWithBusiness();

    const employeeA = await addAndLoginTeamMember(ownerA.cookie, ownerA.business.id, "EMPLOYEE");
    expect(employeeA.addResponse.status).toBe(201);

    // Sanity check: the employee CAN read their own business's data.
    const ownWarehouses = await request(app)
      .get(`/api/businesses/${ownerA.business.id}/warehouses`)
      .set("Cookie", employeeA.cookie);
    expect(ownWarehouses.status).toBe(200);

    const endpoints = [
      { method: "get", path: "warehouses" },
      { method: "get", path: "team" },
      { method: "get", path: "products" },
      { method: "get", path: "stock" },
      { method: "get", path: "stock/movements" },
      { method: "get", path: "transactions" },
    ];

    for (const { method, path } of endpoints) {
      const res = await request(app)
        [method](`/api/businesses/${ownerB.business.id}/${path}`)
        .set("Cookie", employeeA.cookie);

      expect([403]).toContain(res.status);
    }
  });

  test("an admin of business A cannot create resources inside business B", async () => {
    const ownerA = await createSuperAdminWithBusiness();
    const ownerB = await createSuperAdminWithBusiness();

    const adminA = await addAndLoginTeamMember(ownerA.cookie, ownerA.business.id, "ADMIN");

    const res = await request(app)
      .post(`/api/businesses/${ownerB.business.id}/products`)
      .set("Cookie", adminA.cookie)
      .send({ name: "Sneaky Product", unit: "pcs" });

    expect(res.status).toBe(403);
  });

  test("a business's own admin can manage its products", async () => {
    const owner = await createSuperAdminWithBusiness();
    const admin = await addAndLoginTeamMember(owner.cookie, owner.business.id, "ADMIN");

    const res = await request(app)
      .post(`/api/businesses/${owner.business.id}/products`)
      .set("Cookie", admin.cookie)
      .send({ name: "Legit Product", unit: "pcs", price: 100 });

    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe("Legit Product");
  });

  test("rejects a made-up business id with 403, not a 500", async () => {
    const owner = await createSuperAdminWithBusiness();

    const res = await request(app)
      .get("/api/businesses/00000000-0000-0000-0000-000000000000/warehouses")
      .set("Cookie", owner.cookie);

    expect(res.status).toBe(403);
  });

  test("prevents cross-tenant account takeover via addTeamMember and resetTeamMemberPassword", async () => {
    const ownerA = await createSuperAdminWithBusiness();
    const ownerB = await createSuperAdminWithBusiness();
    const staffA = await addAndLoginTeamMember(ownerA.cookie, ownerA.business.id, "EMPLOYEE");

    // Owner B cannot attach Owner A (a SUPERADMIN) to Business B
    const attachOwnerA = await request(app)
      .post(`/api/businesses/${ownerB.business.id}/team`)
      .set("Cookie", ownerB.cookie)
      .send({
        fullName: "Victim Owner",
        username: ownerA.user.username,
        phone: "+2348012345678",
        role: "EMPLOYEE",
      });
    expect(attachOwnerA.status).toBe(409);

    // Owner B cannot attach Owner A's staff member to Business B
    const attachStaffA = await request(app)
      .post(`/api/businesses/${ownerB.business.id}/team`)
      .set("Cookie", ownerB.cookie)
      .send({
        fullName: "Victim Staff",
        username: staffA.user.username,
        phone: "+2348012345678",
        role: "EMPLOYEE",
      });
    expect(attachStaffA.status).toBe(409);

    // Defense in depth: even if a legacy cross-owner BusinessUser row exists,
    // Owner B cannot reset that user's global password.
    const legacyLink = await prisma.businessUser.create({
      data: {
        businessId: ownerB.business.id,
        userId: staffA.user.id,
        role: "EMPLOYEE",
      },
    });
    const crossReset = await request(app)
      .post(`/api/businesses/${ownerB.business.id}/team/${legacyLink.id}/reset-password`)
      .set("Cookie", ownerB.cookie);
    expect(crossReset.status).toBe(403);
    await prisma.businessUser.delete({ where: { id: legacyLink.id } });

    // Legitimate multi-business owner flow: Owner A CAN attach staffA to a second
    // business owned by Owner A, and resetting staffA's password revokes their old session.
    const secondBizRes = await request(app)
      .post("/api/businesses")
      .set("Cookie", ownerA.cookie)
      .send({
        name: "Owner A Branch 2",
        phone: "+2348011111112",
        country: "Nigeria",
        location: "Abuja",
      });
    expect(secondBizRes.status).toBe(201);

    const attachOwnStaff = await request(app)
      .post(`/api/businesses/${secondBizRes.body.data.id}/team`)
      .set("Cookie", ownerA.cookie)
      .send({
        fullName: "Existing Staff",
        username: staffA.user.username,
        phone: "+2348033333333",
        role: "ADMIN",
      });
    expect(attachOwnStaff.status).toBe(201);
    expect(attachOwnStaff.body.data.defaultPassword).toBeUndefined();
    expect(attachOwnStaff.body.message).toMatch(/existing password/i);

    const resetRes = await request(app)
      .post(`/api/businesses/${ownerA.business.id}/team/${staffA.addResponse.body.data.id}/reset-password`)
      .set("Cookie", ownerA.cookie);
    expect(resetRes.status).toBe(200);
    expect(resetRes.body.data.newPassword).toBeTruthy();

    // Old session cookie for staffA must now be rejected (tokenVersion bumped)
    const oldSessionMe = await request(app)
      .get("/api/auth/me")
      .set("Cookie", staffA.cookie);
    expect(oldSessionMe.status).toBe(401);

    // Audit entry must have been recorded
    const auditEntry = await prisma.auditLog.findFirst({
      where: {
        businessId: ownerA.business.id,
        action: "team.password_reset",
      },
    });
    expect(auditEntry).not.toBeNull();
  });

  test("prevents cross-tenant and soft-deleted warehouse/product stock moves (IDOR regression)", async () => {
    const ownerA = await createSuperAdminWithBusiness();
    const ownerB = await createSuperAdminWithBusiness();

    const whA1 = await request(app)
      .post(`/api/businesses/${ownerA.business.id}/warehouses`)
      .set("Cookie", ownerA.cookie)
      .send({ name: "A Primary", location: "Lagos", isPrimary: true });
    const whA2 = await request(app)
      .post(`/api/businesses/${ownerA.business.id}/warehouses`)
      .set("Cookie", ownerA.cookie)
      .send({ name: "A Secondary", location: "Lagos" });
    const whA3Deleted = await request(app)
      .post(`/api/businesses/${ownerA.business.id}/warehouses`)
      .set("Cookie", ownerA.cookie)
      .send({ name: "A Deleted", location: "Lagos" });
    await request(app)
      .delete(`/api/businesses/${ownerA.business.id}/warehouses/${whA3Deleted.body.data.id}`)
      .set("Cookie", ownerA.cookie);

    const whB1 = await request(app)
      .post(`/api/businesses/${ownerB.business.id}/warehouses`)
      .set("Cookie", ownerB.cookie)
      .send({ name: "B Primary", location: "Accra", isPrimary: true });

    const prodA = await request(app)
      .post(`/api/businesses/${ownerA.business.id}/products`)
      .set("Cookie", ownerA.cookie)
      .send({ name: "Product A", unit: "pcs", price: 100 });
    const prodB = await request(app)
      .post(`/api/businesses/${ownerB.business.id}/products`)
      .set("Cookie", ownerB.cookie)
      .send({ name: "Product B", unit: "pcs", price: 200 });

    await request(app)
      .post(`/api/businesses/${ownerA.business.id}/stock/receive`)
      .set("Cookie", ownerA.cookie)
      .send({
        warehouseId: whA1.body.data.id,
        items: [{ productId: prodA.body.data.id, quantity: 50 }],
      });
    await request(app)
      .post(`/api/businesses/${ownerB.business.id}/stock/receive`)
      .set("Cookie", ownerB.cookie)
      .send({
        warehouseId: whB1.body.data.id,
        items: [{ productId: prodB.body.data.id, quantity: 20 }],
      });

    // Owner A attempts to drain Business B's stock into Business A's warehouse
    const stealFromB = await request(app)
      .post(`/api/businesses/${ownerA.business.id}/stock/move`)
      .set("Cookie", ownerA.cookie)
      .send({
        fromWarehouseId: whB1.body.data.id,
        toWarehouseId: whA1.body.data.id,
        productId: prodB.body.data.id,
        quantity: 10,
      });
    expect(stealFromB.status).toBe(404);

    // Owner A attempts to move Business A's stock into Business B's warehouse
    const pushToB = await request(app)
      .post(`/api/businesses/${ownerA.business.id}/stock/move`)
      .set("Cookie", ownerA.cookie)
      .send({
        fromWarehouseId: whA1.body.data.id,
        toWarehouseId: whB1.body.data.id,
        productId: prodA.body.data.id,
        quantity: 5,
      });
    expect(pushToB.status).toBe(404);

    // Owner A attempts to move stock into a soft-deleted warehouse
    const moveToDeleted = await request(app)
      .post(`/api/businesses/${ownerA.business.id}/stock/move`)
      .set("Cookie", ownerA.cookie)
      .send({
        fromWarehouseId: whA1.body.data.id,
        toWarehouseId: whA3Deleted.body.data.id,
        productId: prodA.body.data.id,
        quantity: 5,
      });
    expect(moveToDeleted.status).toBe(404);

    // Verify Business B's stock was completely untouched
    const stockB = await prisma.warehouseStock.findUnique({
      where: {
        warehouseId_productId: {
          warehouseId: whB1.body.data.id,
          productId: prodB.body.data.id,
        },
      },
    });
    expect(stockB.quantity).toBe(20);

    // Sanity check: valid same-business move works atomically
    const validMove = await request(app)
      .post(`/api/businesses/${ownerA.business.id}/stock/move`)
      .set("Cookie", ownerA.cookie)
      .send({
        fromWarehouseId: whA1.body.data.id,
        toWarehouseId: whA2.body.data.id,
        productId: prodA.body.data.id,
        quantity: 10,
      });
    expect(validMove.status).toBe(201);

    const [stockA1, stockA2] = await Promise.all([
      prisma.warehouseStock.findUnique({
        where: { warehouseId_productId: { warehouseId: whA1.body.data.id, productId: prodA.body.data.id } },
      }),
      prisma.warehouseStock.findUnique({
        where: { warehouseId_productId: { warehouseId: whA2.body.data.id, productId: prodA.body.data.id } },
      }),
    ]);
    expect(stockA1.quantity).toBe(40);
    expect(stockA2.quantity).toBe(10);
  });
});
