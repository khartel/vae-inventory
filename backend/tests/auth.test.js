const { app, request } = require("./helpers");

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
});
