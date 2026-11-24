const { app, request, createSuperAdminWithBusiness, addAndLoginTeamMember } = require("./helpers");

describe("Auth", () => {
  test("registers a new SuperAdmin and logs in", async () => {
    const registerRes = await request(app).post("/api/auth/register").send({
      fullName: "Jane Owner",
      username: "jane_owner",
      phone: "08012345678",
      email: "jane_owner@example.com",
      password: "password123",
    });

    expect(registerRes.status).toBe(201);
    expect(registerRes.body.data.role).toBe("SUPERADMIN");
    expect(registerRes.body.data.passwordHash).toBeUndefined();

    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ username: "jane_owner", password: "password123" });

    expect(loginRes.status).toBe(200);
    // Token must never be echoed back in the JSON body — only via httpOnly cookie.
    expect(loginRes.body.data.token).toBeUndefined();
    expect(loginRes.headers["set-cookie"]?.[0]).toMatch(/^token=/);
  });

  test("rejects login with wrong password", async () => {
    await request(app).post("/api/auth/register").send({
      fullName: "Jane Owner",
      username: "jane_owner2",
      phone: "08012345678",
      email: "jane_owner2@example.com",
      password: "password123",
    });

    const res = await request(app)
      .post("/api/auth/login")
      .send({ username: "jane_owner2", password: "wrong-password" });

    expect(res.status).toBe(401);
  });

  test("rejects registration with an invalid payload", async () => {
    const res = await request(app).post("/api/auth/register").send({
      fullName: "",
      username: "ab",
      phone: "123",
      password: "short",
    });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(Array.isArray(res.body.errors)).toBe(true);
  });

  test("rejects duplicate username on registration", async () => {
    await request(app).post("/api/auth/register").send({
      fullName: "First",
      username: "duplicate_user",
      phone: "08000000001",
      email: "duplicate_user_1@example.com",
      password: "password123",
    });

    const res = await request(app).post("/api/auth/register").send({
      fullName: "Second",
      username: "duplicate_user",
      phone: "08000000002",
      email: "duplicate_user_2@example.com",
      password: "password123",
    });

    expect(res.status).toBe(409);
  });

  test("requires authentication for /me", async () => {
    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(401);
  });

  test("preserves mustChangePassword on /auth/me until the user changes their password", async () => {
    const owner = await createSuperAdminWithBusiness();
    const staff = await addAndLoginTeamMember(owner.cookie, owner.business.id, "EMPLOYEE", { skipPasswordChange: true });

    expect(staff.user.mustChangePassword).toBe(true);

    // Simulates a browser reload calling /auth/me before changing password
    const meBefore = await request(app).get("/api/auth/me").set("Cookie", staff.cookie);
    expect(meBefore.status).toBe(200);
    expect(meBefore.body.data.mustChangePassword).toBe(true);

    const blocked = await request(app)
      .get(`/api/businesses/${owner.business.id}/products`)
      .set("Cookie", staff.cookie);
    expect(blocked.status).toBe(403);
    expect(blocked.body.message).toBe("Password change required before continuing");
    const blockedProfile = await request(app)
      .patch("/api/auth/me").set("Cookie", staff.cookie).send({ fullName: "Not yet allowed" });
    expect(blockedProfile.status).toBe(403);

    // After changing password, /auth/me clears mustChangePassword
    const changeRes = await request(app)
      .post("/api/auth/change-password")
      .set("Cookie", staff.cookie)
      .send({
        currentPassword: staff.addResponse.body.data.defaultPassword,
        newPassword: "brandNewPassword123",
      });
    expect(changeRes.status).toBe(200);

    const meAfter = await request(app).get("/api/auth/me").set("Cookie", staff.cookie);
    expect(meAfter.status).toBe(200);
    expect(meAfter.body.data.mustChangePassword).toBe(false);
    expect((await request(app).get(`/api/businesses/${owner.business.id}/products`).set("Cookie", staff.cookie)).status).toBe(200);
  });

  test("staff fixtures complete onboarding by default", async () => {
    const owner = await createSuperAdminWithBusiness();
    const staff = await addAndLoginTeamMember(owner.cookie, owner.business.id);
    expect(staff.user.mustChangePassword).toBe(false);
    expect((await request(app).get(`/api/businesses/${owner.business.id}/products`).set("Cookie", staff.cookie)).status).toBe(200);
  });

  test("a forced-password session may still log out and is then revoked", async () => {
    const owner = await createSuperAdminWithBusiness();
    const staff = await addAndLoginTeamMember(owner.cookie, owner.business.id, "EMPLOYEE", { skipPasswordChange: true });
    expect((await request(app).post("/api/auth/logout").set("Cookie", staff.cookie)).status).toBe(200);
    expect((await request(app).get("/api/auth/me").set("Cookie", staff.cookie)).status).toBe(401);
  });
});
